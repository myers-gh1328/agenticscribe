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
	maxBodyBytes = 1024 * 1024,
	agentBaseUrl,
	agentModel,
	agentFetch = fetch,
	agentEvent = (event) => console.warn(JSON.stringify(event)),
	agentConnectTimeoutMs = 5_000,
	agentCleanupTimeoutMs = 30_000,
	maxAgentBodyBytes = 16 * 1024,
	maxAgentResponseBytes = 64 * 1024,
	maxConcurrentAgentRequests = 2
}) {
	const root = resolve(staticRoot);
	const database = databasePath ? openNotebookDatabase({ path: databasePath }) : undefined;
	const agent = normalizeAgentConfig(agentBaseUrl, agentModel);
	let activeAgentRequests = 0;
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
					syncEnabled,
					agentConfigured: Boolean(agent)
				}, request.method);
				return;
			}
			if (request.url?.startsWith('/api/agent/')) {
				await handleAgentRequest({
					request,
					response,
					agent,
					requiredCapability,
					canonicalOrigin,
					agentFetch,
					agentEvent,
					agentConnectTimeoutMs,
					agentCleanupTimeoutMs,
					maxAgentBodyBytes,
					maxAgentResponseBytes,
					acquireSlot() {
						if (activeAgentRequests >= maxConcurrentAgentRequests) return false;
						activeAgentRequests += 1;
						return true;
					},
					releaseSlot() {
						activeAgentRequests -= 1;
					}
				});
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

function normalizeAgentConfig(baseUrl, model) {
	if (!baseUrl || !model?.trim()) return undefined;
	try {
		const url = new URL(baseUrl);
		if (!['http:', 'https:'].includes(url.protocol)) return undefined;
		return {
			baseUrl: url.toString().replace(/\/$/, ''),
			model: model.trim()
		};
	} catch {
		return undefined;
	}
}

async function handleAgentRequest({
	request,
	response,
	agent,
	requiredCapability,
	canonicalOrigin,
	agentFetch,
	agentEvent,
	agentConnectTimeoutMs,
	agentCleanupTimeoutMs,
	maxAgentBodyBytes,
	maxAgentResponseBytes,
	acquireSlot,
	releaseSlot
}) {
	const authorization = requiredCapability
		? authorizeTailscaleRequest(request, requiredCapability, 'owner')
		: { ok: true };
	if (!authorization.ok) {
		respondJson(response, authorization.status, { error: authorization.error }, request.method);
		return;
	}

	if (request.url === '/api/agent/status') {
		if (request.method !== 'GET') {
			respondJson(response, 405, { error: 'method_not_allowed' }, request.method);
			return;
		}
		if (!agent) {
			respondJson(response, 503, { error: 'agent_unavailable' }, request.method);
			return;
		}
		const probe = await probeAgent({ agent, agentFetch, timeoutMs: agentConnectTimeoutMs, maxAgentResponseBytes });
		if (!probe.available) {
			agentEvent({
				event: 'agent_status_probe_failed',
				outcome: probe.outcome,
				...(probe.code ? { code: probe.code } : {})
			});
		}
		respondJson(response, 200, { configured: true, available: probe.available, model: agent.model }, request.method);
		return;
	}

	if (request.url !== '/api/agent/cleanup' || request.method !== 'POST') {
		respondJson(response, 405, { error: 'method_not_allowed' }, request.method);
		return;
	}
	if (!agent) {
		respondJson(response, 503, { error: 'agent_unavailable' }, request.method);
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

	let thought;
	try {
		const parsed = JSON.parse(await readBoundedBody(request, maxAgentBodyBytes));
		if (
			!parsed ||
			typeof parsed !== 'object' ||
			Array.isArray(parsed) ||
			Object.keys(parsed).length !== 1 ||
			typeof parsed.thought !== 'string' ||
			!parsed.thought.trim()
		) {
			throw new AgentValidationError();
		}
		thought = parsed.thought;
	} catch (error) {
		if (error instanceof BodyTooLargeError) {
			respondJson(response, 413, { error: 'request_too_large' }, request.method);
		} else {
			respondJson(response, 422, { error: 'thought_invalid' }, request.method);
		}
		return;
	}

	if (!acquireSlot()) {
		respondJson(response, 503, { error: 'agent_busy' }, request.method);
		return;
	}
	try {
		const cleanedThought = await requestCleanup({
			agent,
			agentFetch,
			thought,
			timeoutMs: agentCleanupTimeoutMs,
			maxAgentResponseBytes
		});
		respondJson(response, 200, { cleanedThought }, request.method);
	} catch (error) {
		respondJson(
			response,
			error instanceof AgentTimeoutError ? 504 : 502,
			{ error: error instanceof AgentTimeoutError ? 'agent_timeout' : 'agent_failure' },
			request.method
		);
	} finally {
		releaseSlot();
	}
}

async function probeAgent({ agent, agentFetch, timeoutMs, maxAgentResponseBytes }) {
	let response;
	try {
		response = await agentFetch(`${agent.baseUrl}/models`, {
			headers: { Accept: 'application/json' },
			redirect: 'error',
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (error) {
		return {
			available: false,
			outcome: error?.name === 'TimeoutError' ? 'timeout' : 'network_error',
			code: safeNetworkCode(error)
		};
	}
	if (!response.ok) return { available: false, outcome: 'upstream_status' };
	try {
		const result = await readBoundedResponseJson(response, maxAgentResponseBytes);
		const available = result.data?.some((candidate) => candidate?.id === agent.model) === true;
		return { available, outcome: available ? 'available' : 'model_missing' };
	} catch {
		return { available: false, outcome: 'invalid_response' };
	}
}

function safeNetworkCode(error) {
	const code = error?.cause?.code;
	return [
		'EACCES',
		'ECONNREFUSED',
		'ECONNRESET',
		'EHOSTUNREACH',
		'ENETUNREACH',
		'EPERM',
		'ETIMEDOUT',
		'UND_ERR_CONNECT_TIMEOUT'
	].includes(code) ? code : undefined;
}

async function requestCleanup({ agent, agentFetch, thought, timeoutMs, maxAgentResponseBytes }) {
	let response;
	try {
		response = await agentFetch(`${agent.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: agent.model,
				temperature: 0,
				messages: [
					{
						role: 'system',
						content: 'Correct only spelling, grammar, capitalization, and punctuation in the submitted thought. Preserve its meaning, wording, tone, and line breaks. Do not add, remove, summarize, explain, or reorganize anything. Return only the corrected thought without quotation marks.'
					},
					{ role: 'user', content: thought }
				]
			}),
			redirect: 'error',
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (error) {
		if (error?.name === 'TimeoutError') throw new AgentTimeoutError();
		throw new AgentUpstreamError();
	}
	if (!response.ok) throw new AgentUpstreamError();
	const result = await readBoundedResponseJson(response, maxAgentResponseBytes);
	const cleaned = result.choices?.[0]?.message?.content?.trim();
	const outputLimit = Math.max(1024, Buffer.byteLength(thought, 'utf8') * 4);
	if (!cleaned || Buffer.byteLength(cleaned, 'utf8') > outputLimit) throw new AgentUpstreamError();
	return cleaned;
}

async function readBoundedResponseJson(response, maximumBytes) {
	const declared = Number(response.headers.get('content-length') ?? '0');
	if (Number.isFinite(declared) && declared > maximumBytes) throw new AgentUpstreamError();
	if (!response.body) throw new AgentUpstreamError();
	const reader = response.body.getReader();
	let size = 0;
	const chunks = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maximumBytes) {
			await reader.cancel();
			throw new AgentUpstreamError();
		}
		chunks.push(value);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		throw new AgentUpstreamError();
	}
}

class AgentValidationError extends Error {}
class AgentUpstreamError extends Error {}
class AgentTimeoutError extends Error {}

async function handleNotebookRequest({
	request,
	response,
	database,
	syncEnabled,
	canonicalOrigin,
	requiredCapability,
	maxBodyBytes
}) {
	if (!database || !canonicalOrigin) {
		respondJson(response, 503, { error: 'notebook_unavailable' }, request.method);
		return;
	}
	const authorization = requiredCapability
		? authorizeTailscaleRequest(request, requiredCapability)
		: { ok: true, ownerId: 'local-owner' };
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

function authorizeTailscaleRequest(request, requiredCapability, requiredRole) {
	const ownerId = request.headers['tailscale-user-login'];
	if (typeof ownerId !== 'string' || ownerId.length === 0) {
		return { ok: false, status: 401, error: 'identity_required' };
	}
	try {
		const capabilities = JSON.parse(request.headers['tailscale-app-capabilities'] ?? '{}');
		const grants = capabilities[requiredCapability];
		if (
			!Array.isArray(grants) ||
			grants.length === 0 ||
			(requiredRole && !grants.some((grant) => grant?.role === requiredRole))
		) {
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
	response.setHeader('Cache-Control', 'no-store');
	respond(response, status, 'application/json; charset=utf-8', JSON.stringify(value), method);
}
