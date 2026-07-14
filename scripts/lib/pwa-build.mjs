import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export async function stampServiceWorker(outputDirectory) {
	const workerPath = join(outputDirectory, 'sw.js');
	const files = (await builtFiles(outputDirectory)).filter((path) => path !== workerPath).sort();
	const hash = createHash('sha256');
	for (const path of files) {
		hash.update(relative(outputDirectory, path));
		hash.update(await readFile(path));
	}
	const buildId = hash.digest('hex').slice(0, 16);
	const worker = await readFile(workerPath, 'utf8');
	if (!worker.includes('__BUILD_ID__')) throw new Error('Service worker build placeholder is missing.');
	await writeFile(workerPath, worker.replaceAll('__BUILD_ID__', buildId));
	return buildId;
}

async function builtFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(entries.map((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? builtFiles(path) : [path];
	}));
	return nested.flat();
}
