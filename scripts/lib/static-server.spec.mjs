import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStaticServer } from './static-server.mjs';

const cleanup = [];

afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((dispose) => dispose()));
});

describe('static server', () => {
	it('proxies deployment-managed agent status and cleanup without exposing routing to the browser', async () => {
		const upstreamRequests = [];
		const upstream = createServer(async (request, response) => {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			upstreamRequests.push({ url: request.url, method: request.method, body: Buffer.concat(chunks).toString('utf8') });
			response.setHeader('Content-Type', 'application/json');
			if (request.url === '/v1/models') {
				response.end(JSON.stringify({ data: [{ id: 'deployment-model' }] }));
			} else {
				response.end(JSON.stringify({ choices: [{ message: { content: 'A cleaned thought.' } }] }));
			}
		});
		await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
		const upstreamAddress = upstream.address();
		const upstreamUrl = `http://127.0.0.1:${upstreamAddress.port}/v1`;
		const root = await mkdtemp(join(tmpdir(), 'agenticscribe-server-'));
		await writeFile(join(root, 'index.html'), '<h1>AgenticScribe</h1>');
		const server = await startStaticServer({
			host: '127.0.0.1',
			port: 0,
			staticRoot: root,
			canonicalOrigin: 'https://scribe.example.ts.net',
			requiredCapability: 'aegirtech.dev/cap/agenticscribe',
			agentBaseUrl: upstreamUrl,
			agentModel: 'deployment-model'
		});
		cleanup.push(async () => {
			await server.close();
			await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
			await rm(root, { recursive: true, force: true });
		});

		const headers = {
			'Tailscale-User-Login': 'owner@example.test',
			'Tailscale-App-Capabilities': JSON.stringify({
				'aegirtech.dev/cap/agenticscribe': [{ role: 'owner' }]
			})
		};
		const status = await fetch(`${server.url}/api/agent/status`, { headers });
		expect(status.status).toBe(200);
		expect(status.headers.get('cache-control')).toBe('no-store');
		expect(await status.json()).toEqual({ configured: true, available: true, model: 'deployment-model' });

		const cleaned = await fetch(`${server.url}/api/agent/cleanup`, {
			method: 'POST',
			headers: {
				...headers,
				Origin: 'https://scribe.example.ts.net',
				'Content-Type': 'application/json',
				'Sec-Fetch-Site': 'same-origin'
			},
			body: JSON.stringify({ thought: 'a raw thought' })
		});
		expect(cleaned.status).toBe(200);
		expect(await cleaned.json()).toEqual({ cleanedThought: 'A cleaned thought.' });
		expect(upstreamRequests.map(({ url }) => url)).toEqual(['/v1/models', '/v1/chat/completions']);
		const completion = JSON.parse(upstreamRequests[1].body);
		expect(completion).toMatchObject({ model: 'deployment-model', temperature: 0 });
		expect(completion.messages.at(-1)).toEqual({ role: 'user', content: 'a raw thought' });
		expect(JSON.stringify(upstreamRequests)).not.toContain('owner@example.test');
	});

	it('fails agent cleanup closed before contacting upstream when browser request gates fail', async () => {
		const request = vi.fn();
		const root = await mkdtemp(join(tmpdir(), 'agenticscribe-server-'));
		await writeFile(join(root, 'index.html'), '<h1>AgenticScribe</h1>');
		const server = await startStaticServer({
			host: '127.0.0.1',
			port: 0,
			staticRoot: root,
			canonicalOrigin: 'https://scribe.example.ts.net',
			requiredCapability: 'aegirtech.dev/cap/agenticscribe',
			agentBaseUrl: 'http://127.0.0.1:1/v1',
			agentModel: 'deployment-model',
			agentFetch: request
		});
		cleanup.push(async () => {
			await server.close();
			await rm(root, { recursive: true, force: true });
		});
		const response = await fetch(`${server.url}/api/agent/cleanup`, {
			method: 'POST',
			headers: {
				'Tailscale-User-Login': 'owner@example.test',
				'Tailscale-App-Capabilities': JSON.stringify({
					'aegirtech.dev/cap/agenticscribe': [{ role: 'owner' }]
				}),
				Origin: 'https://wrong.example.test',
				'Content-Type': 'application/json',
				'Sec-Fetch-Site': 'same-origin'
			},
			body: JSON.stringify({ thought: 'private text' })
		});

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'request_origin_rejected' });
		expect(request).not.toHaveBeenCalled();
	});
	it('serves health metadata and the single-page app', async () => {
		const root = await mkdtemp(join(tmpdir(), 'agenticscribe-server-'));
		await writeFile(join(root, 'index.html'), '<h1>AgenticScribe</h1>');
		const server = await startStaticServer({ host: '127.0.0.1', port: 0, staticRoot: root });
		cleanup.push(async () => {
			await server.close();
			await rm(root, { recursive: true, force: true });
		});

		const health = await fetch(`${server.url}/healthz`);
		expect(await health.json()).toEqual({ ok: true, service: 'agenticscribe' });

		const page = await fetch(`${server.url}/notes/example`);
		expect(await page.text()).toContain('AgenticScribe');
	});

	it('protects durable notebook state behind Tailscale identity and exact-origin checks', async () => {
		const root = await mkdtemp(join(tmpdir(), 'agenticscribe-server-'));
		await writeFile(join(root, 'index.html'), '<h1>AgenticScribe</h1>');
		const server = await startStaticServer({
			host: '127.0.0.1',
			port: 0,
			staticRoot: root,
			databasePath: join(root, 'notes.sqlite'),
			syncEnabled: true,
			canonicalOrigin: 'https://scribe.example.ts.net',
			requiredCapability: 'aegirtech.dev/cap/agenticscribe'
		});
		cleanup.push(async () => {
			await server.close();
			await rm(root, { recursive: true, force: true });
		});

		const unauthorized = await fetch(`${server.url}/api/notebook/snapshot`);
		expect(unauthorized.status).toBe(401);

		const authorizedHeaders = {
			'Tailscale-User-Login': 'owner@example.test',
			'Tailscale-App-Capabilities': JSON.stringify({
				'aegirtech.dev/cap/agenticscribe': [{ role: 'owner' }]
			})
		};
		const snapshot = await fetch(`${server.url}/api/notebook/snapshot`, {
			headers: authorizedHeaders
		});
		expect(snapshot.status).toBe(200);
		expect(await snapshot.json()).toMatchObject({ schemaVersion: 1, notes: [], folders: [] });

		const wrongOrigin = await fetch(`${server.url}/api/notebook/mutations`, {
			method: 'POST',
			headers: {
				...authorizedHeaders,
				Origin: 'https://wrong.example.test',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(folderMutation())
		});
		expect(wrongOrigin.status).toBe(403);

		const created = await fetch(`${server.url}/api/notebook/mutations`, {
			method: 'POST',
			headers: {
				...authorizedHeaders,
				Origin: 'https://scribe.example.ts.net',
				'Content-Type': 'application/json',
				'Sec-Fetch-Site': 'same-origin'
			},
			body: JSON.stringify(folderMutation())
		});
		expect(created.status).toBe(200);
		expect(await created.json()).toMatchObject({ status: 'applied', entityVersion: 1 });

		const otherOwner = await fetch(`${server.url}/api/notebook/snapshot`, {
			headers: {
				...authorizedHeaders,
				'Tailscale-User-Login': 'other-owner@example.test'
			}
		});
		expect(await otherOwner.json()).toMatchObject({ notes: [], folders: [] });
	});

	it('fails closed when sync is disabled and rejects oversized JSON before mutation', async () => {
		const root = await mkdtemp(join(tmpdir(), 'agenticscribe-server-'));
		await writeFile(join(root, 'index.html'), '<h1>AgenticScribe</h1>');
		const server = await startStaticServer({
			host: '127.0.0.1',
			port: 0,
			staticRoot: root,
			databasePath: join(root, 'notes.sqlite'),
			syncEnabled: false,
			canonicalOrigin: 'https://scribe.example.ts.net',
			requiredCapability: 'aegirtech.dev/cap/agenticscribe',
			maxBodyBytes: 128
		});
		cleanup.push(async () => {
			await server.close();
			await rm(root, { recursive: true, force: true });
		});

		const readiness = await fetch(`${server.url}/readyz`);
		expect(readiness.status).toBe(200);
		expect(await readiness.json()).toMatchObject({
			ok: true,
			service: 'agenticscribe',
			schemaVersion: 1,
			syncEnabled: false
		});

		const headers = {
			'Tailscale-User-Login': 'owner@example.test',
			'Tailscale-App-Capabilities': JSON.stringify({
				'aegirtech.dev/cap/agenticscribe': [{ role: 'owner' }]
			}),
			Origin: 'https://scribe.example.ts.net',
			'Content-Type': 'application/json',
			'Sec-Fetch-Site': 'same-origin'
		};
		const disabled = await fetch(`${server.url}/api/notebook/mutations`, {
			method: 'POST',
			headers,
			body: JSON.stringify(folderMutation())
		});
		expect(disabled.status).toBe(503);

		const oversizedServer = await startStaticServer({
			host: '127.0.0.1',
			port: 0,
			staticRoot: root,
			databasePath: join(root, 'oversized.sqlite'),
			syncEnabled: true,
			canonicalOrigin: 'https://scribe.example.ts.net',
			requiredCapability: 'aegirtech.dev/cap/agenticscribe',
			maxBodyBytes: 128
		});
		cleanup.push(() => oversizedServer.close());
		const oversized = await fetch(`${oversizedServer.url}/api/notebook/mutations`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ ...folderMutation(), padding: 'x'.repeat(256) })
		});
		expect(oversized.status).toBe(413);
	});
});

function folderMutation() {
	return {
		mutationId: crypto.randomUUID(),
		type: 'put-folder',
		entityId: 'folder-work',
		expectedVersion: 0,
		folder: { id: 'folder-work', name: 'Work', parentId: null }
	};
}
