import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import {
	MutationConflictError,
	MutationValidationError,
	openNotebookDatabase
} from './notebook-database.mjs';

const contentTypes = new Map([
	['.css', 'text/css; charset=utf-8'],
	['.html', 'text/html; charset=utf-8'],
	['.js', 'text/javascript; charset=utf-8'],
	['.json', 'application/json; charset=utf-8'],
	['.svg', 'image/svg+xml'],
	['.woff2', 'font/woff2'],
]);

export async function startStaticServer({
	host,
	port,
	staticRoot,
	databasePath,
	syncEnabled = false,
	canonicalOrigin,
	requiredCapability,
	maxBodyBytes = 1024 * 1024
}) {
	const root = resolve(staticRoot);
	const database = databasePath ? openNotebookDatabase({ path: databasePath }) : undefined;
	const server = createServer(async (request, response) => {
		try {
			if (request.url === '/healthz') {
				respond(response, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, service: 'agenticscribe' }), request.method);
				return;
			}
			if (request.url === '/readyz') {
				const health = database?.health();
				const ready = !database || health?.integrity === 'ok';
				respondJson(response, ready ? 200 : 503, {
					ok: ready,
					service: 'agenticscribe',
					schemaVersion: health?.schemaVersion,
					syncEnabled
				}, request.method);
				return;
			}
			if (request.url?.startsWith('/api/notebook/')) {
				await handleNotebookRequest({
					request,
					response,
					database,
					syncEnabled,
					canonicalOrigin,
					requiredCapability,
					maxBodyBytes
				});
				return;
			}

			const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
			const requested = resolve(root, `.${pathname}`);
			if (requested !== root && !requested.startsWith(`${root}${sep}`)) {
				respond(response, 404, 'text/plain; charset=utf-8', 'Not found', request.method);
				return;
			}

			const filePath = await existingFile(requested) ?? resolve(root, 'index.html');
			const body = await readFile(filePath);
			response.setHeader('Cache-Control', extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable');
			respond(response, 200, contentTypes.get(extname(filePath)) ?? 'application/octet-stream', body, request.method);
		} catch {
			respond(response, 404, 'text/plain; charset=utf-8', 'Not found', request.method);
		}
	});

	await new Promise((resolveListen, reject) => {
	server.once('error', reject);
		server.listen(port, host, resolveListen);
	});
	server.headersTimeout = 10_000;
	server.requestTimeout = 15_000;
	server.keepAliveTimeout = 5_000;
	const address = server.address();
	const actualPort = typeof address === 'object' && address ? address.port : port;
	return {
		url: `http://${host}:${actualPort}`,
		close: () => new Promise((resolveClose, reject) => server.close((error) => {
			database?.close();
			if (error) reject(error);
			else resolveClose();
		})),
	};
}

async function handleNotebookRequest({
	request,
	response,
	database,
	syncEnabled,
	canonicalOrigin,
	requiredCapability,
	maxBodyBytes
}) {
	if (!database || !canonicalOrigin || !requiredCapability) {
		respondJson(response, 503, { error: 'notebook_unavailable' }, request.method);
		return;
	}
	const authorization = authorizeTailscaleRequest(request, requiredCapability);
	if (!authorization.ok) {
		respondJson(response, authorization.status, { error: authorization.error }, request.method);
		return;
	}

	if (request.url === '/api/notebook/snapshot' && request.method === 'GET') {
		respondJson(response, 200, database.snapshot(authorization.ownerId), request.method);
		return;
	}
	if (request.url !== '/api/notebook/mutations' || request.method !== 'POST') {
		respondJson(response, 405, { error: 'method_not_allowed' }, request.method);
		return;
	}
	if (!syncEnabled) {
		respondJson(response, 503, { error: 'sync_disabled' }, request.method);
		return;
	}
	if (request.headers.origin !== canonicalOrigin || request.headers['sec-fetch-site'] !== 'same-origin') {
		respondJson(response, 403, { error: 'request_origin_rejected' }, request.method);
		return;
	}
	if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
		respondJson(response, 415, { error: 'json_required' }, request.method);
		return;
	}

	try {
		const body = await readBoundedBody(request, maxBodyBytes);
		const result = database.applyMutation(JSON.parse(body), authorization.ownerId);
		respondJson(response, 200, result, request.method);
	} catch (error) {
		if (error instanceof BodyTooLargeError) {
			respondJson(response, 413, { error: 'request_too_large' }, request.method);
		} else if (error instanceof MutationConflictError) {
			respondJson(response, 409, { error: 'mutation_conflict', current: error.current }, request.method);
		} else if (error instanceof MutationValidationError || error instanceof SyntaxError) {
			respondJson(response, 422, { error: 'mutation_invalid' }, request.method);
		} else {
			respondJson(response, 500, { error: 'notebook_failure' }, request.method);
		}
	}
}

function authorizeTailscaleRequest(request, requiredCapability) {
	const ownerId = request.headers['tailscale-user-login'];
	if (typeof ownerId !== 'string' || ownerId.length === 0) {
		return { ok: false, status: 401, error: 'identity_required' };
	}
	try {
		const capabilities = JSON.parse(request.headers['tailscale-app-capabilities'] ?? '{}');
		if (!Array.isArray(capabilities[requiredCapability]) || capabilities[requiredCapability].length === 0) {
			return { ok: false, status: 403, error: 'capability_required' };
		}
		return { ok: true, ownerId };
	} catch {
		return { ok: false, status: 403, error: 'capability_required' };
	}
}

class BodyTooLargeError extends Error {}

async function readBoundedBody(request, maximumBytes) {
	const declared = Number(request.headers['content-length'] ?? '0');
	if (Number.isFinite(declared) && declared > maximumBytes) throw new BodyTooLargeError();
	let size = 0;
	const chunks = [];
	for await (const chunk of request) {
		size += chunk.length;
		if (size > maximumBytes) throw new BodyTooLargeError();
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString('utf8');
}

async function existingFile(path) {
	try {
		return (await stat(path)).isFile() ? path : null;
	} catch {
		return null;
	}
}

function respond(response, status, contentType, body, method) {
	response.statusCode = status;
	response.setHeader('Content-Type', contentType);
	response.setHeader('X-Content-Type-Options', 'nosniff');
	response.end(method === 'HEAD' ? undefined : body);
}

function respondJson(response, status, value, method) {
	respond(response, status, 'application/json; charset=utf-8', JSON.stringify(value), method);
}
