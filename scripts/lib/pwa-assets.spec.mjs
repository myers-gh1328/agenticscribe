import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('PWA assets', () => {
	it('declares an installable standalone application with required icons', async () => {
		const manifest = JSON.parse(await readFile(resolve('public/manifest.webmanifest'), 'utf8'));
		expect(manifest).toMatchObject({
			name: 'AgenticScribe', short_name: 'Scribe', start_url: '/', scope: '/', display: 'standalone'
		});
		expect(manifest.icons).toEqual(expect.arrayContaining([
			expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
			expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
			expect.objectContaining({ sizes: '512x512', purpose: 'maskable' })
		]));
	});

	it('links the manifest and keeps authentication and APIs network-only', async () => {
		const html = await readFile(resolve('src/app.html'), 'utf8');
		const worker = await readFile(resolve('public/sw.js'), 'utf8');
		expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
		expect(worker).toContain("pathname.startsWith('/api/')");
		expect(worker).toContain("pathname.startsWith('/auth/')");
		expect(worker).toContain('event.respondWith(fetch(request))');
	});
});
