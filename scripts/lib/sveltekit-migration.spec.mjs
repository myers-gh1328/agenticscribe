import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('SvelteKit application boundary', () => {
	it('uses SvelteKit for the frontend while preserving the custom Node server', async () => {
		const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
		const svelteConfig = await readFile(new URL('../../svelte.config.js', import.meta.url), 'utf8');
		const rootLayout = await readFile(new URL('../../src/routes/+layout.ts', import.meta.url), 'utf8');

		expect(packageJson.devDependencies).toMatchObject({
			'@sveltejs/adapter-static': expect.any(String),
			'@sveltejs/kit': expect.any(String),
			svelte: expect.any(String),
			'svelte-check': expect.any(String)
		});
		expect(packageJson.scripts.start).toBe('node scripts/serve.mjs');
		expect(svelteConfig).toContain("adapter-static");
		expect(svelteConfig).toContain("assets: 'public'");
		expect(svelteConfig).toContain("fallback: '200.html'");
		expect(rootLayout).toContain('export const prerender = true');
	});
});
