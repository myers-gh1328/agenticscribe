import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupNotebookDatabase } from './notebook-backup.mjs';
import { openNotebookDatabase } from './notebook-database.mjs';

const cleanup = [];

afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('notebook backup', () => {
	it('creates a private, integrity-checked snapshot while the source database is open', async () => {
		const root = await mkdtemp(join(tmpdir(), 'agenticscribe-snapshot-'));
		cleanup.push(root);
		const sourcePath = join(root, 'live', 'notes.sqlite');
		const snapshotPath = join(root, 'snapshots', 'notes.sqlite');
		const live = openNotebookDatabase({ path: sourcePath });
		live.applyMutation(folderMutation(), 'owner@example.test');

		const result = await backupNotebookDatabase({ sourcePath, destinationPath: snapshotPath });
	expect(result).toMatchObject({ integrity: 'ok', schemaVersion: 3 });
		expect((await stat(snapshotPath)).mode & 0o777).toBe(0o600);

		const restored = openNotebookDatabase({ path: snapshotPath });
		expect(restored.snapshot('owner@example.test').folders).toEqual([
			expect.objectContaining({ id: 'folder-work', name: 'Work', serverVersion: 1 })
		]);
		restored.close();
		live.close();
	});
});

function folderMutation() {
	return {
		mutationId: crypto.randomUUID(),
		type: 'put-folder',
		entityId: 'folder-work',
		expectedVersion: 0,
		folder: { id: 'folder-work', name: 'Work', parentId: null }
	};
}
