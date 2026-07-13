import { cp, mkdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function publishRelease({ distRoot, releaseRoot, releaseId }) {
	const root = resolve(releaseRoot);
	const releasesDir = join(root, 'releases');
	const releaseDir = join(releasesDir, releaseId);
	const currentLink = join(root, 'current');
	const nextLink = join(root, '.current-next');

	await mkdir(releasesDir, { recursive: true });
	await mkdir(releaseDir, { recursive: false });
	await cp(resolve(distRoot), join(releaseDir, 'dist'), { recursive: true });
	await rm(nextLink, { recursive: true, force: true });
	await symlink(releaseDir, nextLink, process.platform === 'win32' ? 'junction' : 'dir');
	if (process.platform === 'win32') await rm(currentLink, { recursive: true, force: true });
	await rename(nextLink, currentLink);

	return { releaseDir, currentLink };
}

export async function currentRelease(releaseRoot) {
	try {
		return await readlink(join(resolve(releaseRoot), 'current'));
	} catch {
		return null;
	}
}

export async function selectRelease(releaseRoot, releaseDir) {
	const root = resolve(releaseRoot);
	const currentLink = join(root, 'current');
	const nextLink = join(root, '.current-next');
	await rm(nextLink, { recursive: true, force: true });
	await symlink(releaseDir, nextLink, process.platform === 'win32' ? 'junction' : 'dir');
	if (process.platform === 'win32') await rm(currentLink, { recursive: true, force: true });
	await rename(nextLink, currentLink);
}
