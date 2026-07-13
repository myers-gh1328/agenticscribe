import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStaticServer } from './static-server.mjs';

const cleanup = [];

afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((dispose) => dispose()));
});

describe('static server', () => {
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
});
