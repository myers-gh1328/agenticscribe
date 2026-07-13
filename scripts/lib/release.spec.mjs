import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishRelease } from './release.mjs';

describe('release publishing', () => {
	it('publishes dist and selects the new release', async () => {
		const root = await mkdtemp(join(tmpdir(), 'agenticscribe-release-'));
		const dist = join(root, 'dist');
		const releases = join(root, 'runtime');
		await mkdir(dist);
		await writeFile(join(dist, 'index.html'), 'new release');

		const result = await publishRelease({ distRoot: dist, releaseRoot: releases, releaseId: '20260713120000' });

		expect(await readFile(join(result.releaseDir, 'dist', 'index.html'), 'utf8')).toBe('new release');
		expect(await readlink(join(releases, 'current'))).toBe(result.releaseDir);
		await rm(root, { recursive: true, force: true });
	});
});
