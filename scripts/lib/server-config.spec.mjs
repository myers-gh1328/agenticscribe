import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServerOptions } from './server-config.mjs';

describe('server runtime configuration', () => {
	it('keeps authentication disabled without requiring Entra credentials', () => {
		const options = createServerOptions({
			HOST: '127.0.0.1',
			PORT: '3014',
			AGENTIC_SCRIBE_STATIC_DIR: 'dist',
			AGENTIC_SCRIBE_AUTH_ENABLED: 'false'
		});

		expect(options.authentication).toBeUndefined();
		expect(options.host).toBe('127.0.0.1');
		expect(options.port).toBe(3014);
	});

	it('loads complete Entra configuration and credentials through runtime-config', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'agenticscribe-config-'));
		const clientSecretFile = join(directory, 'client');
		const sessionSecretFile = join(directory, 'session');
		await writeFile(clientSecretFile, 'synthetic-client-secret\n', { mode: 0o600 });
		await writeFile(sessionSecretFile, 'synthetic-session-secret-with-at-least-thirty-two-bytes\n', { mode: 0o600 });

		const options = createServerOptions({
			AGENTIC_SCRIBE_AUTH_ENABLED: 'true',
			AGENTIC_SCRIBE_CANONICAL_ORIGIN: 'https://notes.example.test',
			AGENTIC_SCRIBE_ENTRA_TENANT_ID: 'tenant-id',
			AGENTIC_SCRIBE_ENTRA_CLIENT_ID: 'client-id',
			AGENTIC_SCRIBE_ENTRA_CLIENT_SECRET_FILE: clientSecretFile,
			AGENTIC_SCRIBE_ENTRA_REDIRECT_URIS: 'https://notes.example.test/auth/callback',
			AGENTIC_SCRIBE_ENTRA_POST_LOGOUT_REDIRECT_URI: 'https://notes.example.test/',
			AGENTIC_SCRIBE_ENTRA_ALLOWED_OBJECT_IDS: 'owner-one, owner-two',
			AGENTIC_SCRIBE_SESSION_SECRET_FILE: sessionSecretFile
		});

		expect(options.authentication).toBeDefined();
		expect(options.canonicalOrigin).toBe('https://notes.example.test');
		expect(options.requiredCapability).toBeUndefined();
	});

	it('fails startup when enabled authentication configuration is incomplete', () => {
		expect(() => createServerOptions({ AGENTIC_SCRIBE_AUTH_ENABLED: 'true' }))
			.toThrow(/AGENTIC_SCRIBE_CANONICAL_ORIGIN is required/);
	});
});
