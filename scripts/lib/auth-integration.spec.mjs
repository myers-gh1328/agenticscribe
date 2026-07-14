import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOwnerOidc } from '@myers-gh1328/owner-oidc';
import { startStaticServer } from './static-server.mjs';

const cleanup = [];

afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((dispose) => dispose()));
});

describe('Entra package integration', () => {
	it('keeps health public, redirects navigation, and returns JSON 401 for APIs', async () => {
		const { server } = await startAuthenticatedServer();

		const health = await fetch(`${server.url}/healthz`);
		expect(health.status).toBe(200);
		const readiness = await fetch(`${server.url}/readyz`);
		expect(readiness.status).toBe(200);
		expect(await readiness.json()).toMatchObject({ authEnabled: true });

		const page = await fetch(`${server.url}/notes/example`, { redirect: 'manual' });
		expect(page.status).toBe(302);
		expect(page.headers.get('location')).toBe('/auth/login?returnTo=%2Fnotes%2Fexample');

		const api = await fetch(`${server.url}/api/notebook/snapshot`, {
			headers: {
				Host: 'attacker.example',
				'Tailscale-User-Login': 'forged@example.test',
				'Tailscale-App-Capabilities': JSON.stringify({ '*': [{ role: 'owner' }] })
			}
		});
		expect(api.status).toBe(401);
		expect(await api.json()).toEqual({ error: 'authentication_required' });
	});

	it('prevents browser caching of authenticated session metadata', async () => {
		const { server } = await startAuthenticatedServer();
		const response = await fetch(`${server.url}/api/auth/session`);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('fails closed when an authentication adapter omits the verified object ID', async () => {
		const root = await mkdtemp(join(tmpdir(), 'agenticscribe-invalid-auth-'));
		await writeFile(join(root, 'index.html'), '<h1>AgenticScribe</h1>');
		const server = await startStaticServer({
			host: '127.0.0.1',
			port: 0,
			staticRoot: root,
			databasePath: join(root, 'notes.sqlite'),
			syncEnabled: true,
			canonicalOrigin: 'https://notes.example.test',
			authentication: {
				handle: async () => undefined,
				session: () => ({ authenticated: true, user: null }),
				protect: () => new Response(null, { status: 302 })
			}
		});
		cleanup.push(async () => {
			await server.close();
			await rm(root, { recursive: true, force: true });
		});

		const snapshot = await fetch(`${server.url}/api/notebook/snapshot`);
		expect(snapshot.status).toBe(401);
		expect(await snapshot.json()).toEqual({ error: 'authentication_required' });
	});

	it('uses the verified Entra object ID to isolate each user notebook', async () => {
		const { server } = await startAuthenticatedServer();
		const ownerOne = await authenticate(server, 'owner-one', 'state-one');
		const ownerTwo = await authenticate(server, 'owner-two', 'state-two');

		const created = await fetch(`${server.url}/api/notebook/mutations`, {
			method: 'POST',
			headers: {
				Cookie: ownerOne,
				Origin: 'https://notes.example.test',
				'Content-Type': 'application/json',
				'Sec-Fetch-Site': 'same-origin'
			},
			body: JSON.stringify({
				mutationId: 'owner-one-folder-mutation',
				type: 'put-folder',
				entityId: 'private-folder',
				expectedVersion: 0,
				folder: { id: 'private-folder', name: 'Owner One', parentId: null }
			})
		});
		expect(created.status).toBe(200);

		const ownerTwoSnapshot = await fetch(`${server.url}/api/notebook/snapshot`, {
			headers: { Cookie: ownerTwo }
		});
		expect(await ownerTwoSnapshot.json()).toMatchObject({ notes: [], folders: [] });

		const ownerOneSnapshot = await fetch(`${server.url}/api/notebook/snapshot`, {
			headers: { Cookie: ownerOne }
		});
		expect((await ownerOneSnapshot.json()).folders).toHaveLength(1);
	});
});

async function authenticate(server, objectId, state) {
	const login = await fetch(`${server.url}/auth/login`, { redirect: 'manual' });
	const pendingCookie = login.headers.getSetCookie()[0].split(';')[0];
	const callback = await fetch(`${server.url}/auth/callback?code=${objectId}&state=${state}`, {
		redirect: 'manual',
		headers: { Cookie: pendingCookie }
	});
	expect(callback.status).toBe(302);
	return callback.headers.getSetCookie().find((value) => value.startsWith('scribe_session=')).split(';')[0];
}

async function startAuthenticatedServer() {
	const root = await mkdtemp(join(tmpdir(), 'agenticscribe-auth-'));
	await writeFile(join(root, 'index.html'), '<h1>AgenticScribe</h1>');
	const randomValues = ['state-one', 'nonce-one', 'verifier-one', 'state-two', 'nonce-two', 'verifier-two'];
	const authentication = createOwnerOidc({
		tenantId: 'tenant-id',
		clientId: 'client-id',
		clientSecret: 'synthetic-client-secret',
		redirectUris: ['https://notes.example.test/auth/callback'],
		postLogoutRedirectUri: 'https://notes.example.test/',
		allowedObjectIds: ['owner-one', 'owner-two'],
		cookieSecret: 'synthetic-cookie-signing-secret-with-at-least-32-bytes',
		cookiePrefix: 'scribe',
		publicPaths: ['/healthz', '/readyz'],
		randomValue: () => randomValues.shift(),
		tokenFetch: async (_url, options) => Response.json({ id_token: new URLSearchParams(options.body).get('code') }),
		verifyIdToken: async (objectId) => ({
			oid: objectId,
			nonce: objectId === 'owner-one' ? 'nonce-one' : 'nonce-two',
			exp: 4_000_000_000
		})
	});
	const server = await startStaticServer({
		host: '127.0.0.1',
		port: 0,
		staticRoot: root,
		databasePath: join(root, 'notes.sqlite'),
		syncEnabled: true,
		canonicalOrigin: 'https://notes.example.test',
		requiredCapability: 'must-not-authorize-when-entra-enabled',
		authentication
	});
	cleanup.push(async () => {
		await server.close();
		await rm(root, { recursive: true, force: true });
	});
	return { server };
}
