import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stampServiceWorker } from './pwa-build.mjs';

const cleanup = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe('PWA build stamping', () => {
	it('derives a stable cache ID from built shell contents and changes it with the shell', async () => {
		const first = await fixture('first-shell');
		const second = await fixture('second-shell');
		const firstId = await stampServiceWorker(first);
		const secondId = await stampServiceWorker(second);

		expect(firstId).not.toBe(secondId);
		expect(await readFile(join(first, 'sw.js'), 'utf8')).toContain(`agenticscribe-shell-${firstId}`);
		expect(await readFile(join(first, 'sw.js'), 'utf8')).not.toContain('__BUILD_ID__');
	});
});

async function fixture(shell) {
	const root = await mkdtemp(join(tmpdir(), 'agenticscribe-pwa-build-'));
	cleanup.push(root);
	await mkdir(join(root, 'assets'));
	await writeFile(join(root, 'index.html'), `<script src="/assets/app.js"></script>${shell}`);
	await writeFile(join(root, 'assets/app.js'), shell);
	await writeFile(join(root, 'sw.js'), "const cacheName = 'agenticscribe-shell-__BUILD_ID__';");
	return root;
}
