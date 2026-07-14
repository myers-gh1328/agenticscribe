import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishRelease } from './release.mjs';

describe('release publishing', () => {
	it('publishes the static assets and server runtime before selecting the new release', async () => {
		const root = await mkdtemp(join(tmpdir(), 'agenticscribe-release-'));
		const project = join(root, 'project');
		const dist = join(project, 'dist');
		const releases = join(root, 'runtime');
		await mkdir(join(project, 'scripts'), { recursive: true });
		await mkdir(dist);
		await writeFile(join(dist, 'index.html'), 'new release');
		await writeFile(join(project, 'scripts', 'serve.mjs'), 'server runtime');
		await writeFile(join(project, 'package.json'), '{"type":"module"}');
		await writeFile(join(project, 'package-lock.json'), '{}');

		const result = await publishRelease({
			projectRoot: project,
			distRoot: dist,
			releaseRoot: releases,
			releaseId: '20260713120000'
		});

		expect(await readFile(join(result.releaseDir, 'dist', 'index.html'), 'utf8')).toBe('new release');
		expect(await readFile(join(result.releaseDir, 'scripts', 'serve.mjs'), 'utf8')).toBe('server runtime');
		expect(await readFile(join(result.releaseDir, 'package.json'), 'utf8')).toBe('{"type":"module"}');
		expect(await readlink(join(releases, 'current'))).toBe(result.releaseDir);
		await rm(root, { recursive: true, force: true });
	});
});
