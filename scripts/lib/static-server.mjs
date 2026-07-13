import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const contentTypes = new Map([
	['.css', 'text/css; charset=utf-8'],
	['.html', 'text/html; charset=utf-8'],
	['.js', 'text/javascript; charset=utf-8'],
	['.json', 'application/json; charset=utf-8'],
	['.svg', 'image/svg+xml'],
	['.woff2', 'font/woff2'],
]);

export async function startStaticServer({ host, port, staticRoot }) {
	const root = resolve(staticRoot);
	const server = createServer(async (request, response) => {
		try {
			if (request.url === '/healthz') {
				respond(response, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, service: 'agenticscribe' }), request.method);
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
	const address = server.address();
	const actualPort = typeof address === 'object' && address ? address.port : port;
	return {
		url: `http://${host}:${actualPort}`,
		close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
	};
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
