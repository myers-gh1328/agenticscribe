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

	it('uses the configured canonical origin and preserves the stable local owner after login', async () => {
		const { server } = await startAuthenticatedServer();
		const login = await fetch(`${server.url}/auth/login?returnTo=%2F`, {
			redirect: 'manual',
			headers: { Host: 'attacker.example' }
		});
		const authorization = new URL(login.headers.get('location'));
		expect(authorization.searchParams.get('redirect_uri')).toBe('https://notes.example.test/auth/callback');
		const pendingCookie = login.headers.getSetCookie()[0].split(';')[0];

		const callback = await fetch(`${server.url}/auth/callback?code=synthetic&state=state`, {
			redirect: 'manual',
			headers: { Cookie: pendingCookie, Host: 'attacker.example' }
		});
		expect(callback.status).toBe(302);
		const sessionCookie = callback.headers.getSetCookie().find((value) => value.startsWith('scribe_session=')).split(';')[0];

		const snapshot = await fetch(`${server.url}/api/notebook/snapshot`, {
			headers: {
				Cookie: sessionCookie,
				'Tailscale-User-Login': 'must-not-become-owner@example.test'
			}
		});
		expect(snapshot.status).toBe(200);
		expect(await snapshot.json()).toMatchObject({ notes: [], folders: [] });
	});
});

async function startAuthenticatedServer() {
	const root = await mkdtemp(join(tmpdir(), 'agenticscribe-auth-'));
	await writeFile(join(root, 'index.html'), '<h1>AgenticScribe</h1>');
	const randomValues = ['state', 'nonce', 'verifier'];
	const authentication = createOwnerOidc({
		tenantId: 'tenant-id',
		clientId: 'client-id',
		clientSecret: 'synthetic-client-secret',
		redirectUris: ['https://notes.example.test/auth/callback'],
		postLogoutRedirectUri: 'https://notes.example.test/',
		allowedObjectIds: ['owner-id'],
		cookieSecret: 'synthetic-cookie-signing-secret-with-at-least-32-bytes',
		cookiePrefix: 'scribe',
		publicPaths: ['/healthz', '/readyz'],
		randomValue: () => randomValues.shift(),
		tokenFetch: async () => Response.json({ id_token: 'synthetic-token' }),
		verifyIdToken: async () => ({ oid: 'owner-id', nonce: 'nonce', exp: 4_000_000_000 })
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
