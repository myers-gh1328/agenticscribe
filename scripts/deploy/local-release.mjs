import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentRelease, publishRelease, selectRelease } from '../lib/release.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const releaseRoot = resolve(process.env.AGENTIC_SCRIBE_RELEASE_ROOT ?? join(repoRoot, 'releases', 'local'));
const healthUrl = process.env.AGENTIC_SCRIBE_HEALTH_URL ?? `http://127.0.0.1:${process.env.PORT ?? '3014'}/healthz`;
const previousRelease = await currentRelease(releaseRoot);

run(process.env.npm_execpath ? process.execPath : 'npm', process.env.npm_execpath ? [process.env.npm_execpath, 'run', 'build'] : ['run', 'build']);
const release = await publishRelease({
	projectRoot: repoRoot,
	distRoot: join(repoRoot, 'dist'),
	releaseRoot,
	releaseId: timestamp()
});

if (process.env.AGENTIC_SCRIBE_RESTART_COMMAND) runShell(process.env.AGENTIC_SCRIBE_RESTART_COMMAND);
if (process.env.AGENTIC_SCRIBE_SKIP_HEALTH_CHECK === 'true' || await waitForHealth(healthUrl)) {
	console.log(`Deployed AgenticScribe release ${release.releaseDir}`);
	process.exit(0);
}

if (previousRelease) {
	await selectRelease(releaseRoot, previousRelease);
	if (process.env.AGENTIC_SCRIBE_RESTART_COMMAND) runShell(process.env.AGENTIC_SCRIBE_RESTART_COMMAND);
}
console.error(`AgenticScribe did not become healthy at ${healthUrl}; the previous release was restored.`);
process.exit(1);

function run(command, args) {
	const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function runShell(command) {
	const result = spawnSync(command, { cwd: repoRoot, stdio: 'inherit', shell: true });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

async function waitForHealth(url) {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		try {
			const response = await fetch(url);
			if (response.ok) return true;
		} catch {}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
	}
	return false;
}

function timestamp() {
	return new Date().toISOString().replaceAll(/[-:TZ.]/g, '').slice(0, 14);
}
