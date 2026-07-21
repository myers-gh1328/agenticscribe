import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	MutationConflictError,
	openNotebookDatabase
} from './notebook-database.mjs';

const cleanups = [];

afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function createDatabase() {
	const directory = await mkdtemp(join(tmpdir(), 'agenticscribe-db-'));
	const database = openNotebookDatabase({
		path: join(directory, 'notes.sqlite'),
		now: () => '2026-07-14T01:00:00.000Z'
	});
	cleanups.push(async () => {
		database.close();
		await rm(directory, { recursive: true, force: true });
	});
	return database;
}

function putFolder(overrides = {}) {
	return {
		mutationId: crypto.randomUUID(),
		type: 'put-folder',
		entityId: 'folder-work',
		expectedVersion: 0,
		folder: { id: 'folder-work', name: 'Work', parentId: null },
		...overrides
	};
}

function putNote(overrides = {}) {
	return {
		mutationId: crypto.randomUUID(),
		type: 'put-note',
		entityId: 'note-1',
		expectedVersion: 0,
		note: {
			id: 'note-1',
			title: 'Durable title',
			text: 'Durable thought\n',
			finalText: '# Final\n\nDurable summary.',
			thoughts: [{ id: 'thought-1', end: 16 }],
			location: 'folder-work'
		},
		...overrides
	};
}

describe('notebook database', () => {
	it('isolates notebooks and idempotency receipts by authenticated owner identity', async () => {
		const database = await createDatabase();
		const mutation = putFolder({ mutationId: 'same-mutation-id' });

		database.applyMutation(mutation, 'owner-a@example.test');
		database.applyMutation(
			{ ...mutation, folder: { ...mutation.folder, name: 'Owner B Work' } },
			'owner-b@example.test'
		);

		expect(database.snapshot('owner-a@example.test').folders).toEqual([
			expect.objectContaining({ name: 'Work' })
		]);
		expect(database.snapshot('owner-b@example.test').folders).toEqual([
			expect.objectContaining({ name: 'Owner B Work' })
		]);
	});

	it('persists folders and notes as versioned server state', async () => {
		const database = await createDatabase();

		const folderResult = database.applyMutation(putFolder());
		const noteResult = database.applyMutation(putNote());

		expect(folderResult).toMatchObject({ status: 'applied', entityVersion: 1 });
		expect(noteResult).toMatchObject({ status: 'applied', entityVersion: 1 });
		expect(database.snapshot()).toEqual({
			schemaVersion: 3,
			folders: [
				expect.objectContaining({ id: 'folder-work', name: 'Work', serverVersion: 1 })
			],
			notes: [
				expect.objectContaining({
					id: 'note-1',
					title: 'Durable title',
					text: 'Durable thought\n',
					finalText: '# Final\n\nDurable summary.',
					serverVersion: 1
				})
			]
		});
	});

	it('returns the recorded result for an identical retry and rejects UUID reuse', async () => {
		const database = await createDatabase();
		const mutation = putFolder({ mutationId: 'mutation-stable' });

		const first = database.applyMutation(mutation);
		const retry = database.applyMutation(structuredClone(mutation));

		expect(retry).toEqual({ ...first, status: 'duplicate' });
		expect(() =>
			database.applyMutation({
				...mutation,
				folder: { ...mutation.folder, name: 'Different' }
			})
		).toThrow(MutationConflictError);
	});

	it('rejects stale writes without replacing the current entity', async () => {
		const database = await createDatabase();
		database.applyMutation(putFolder());
		const first = database.applyMutation(putNote());
		database.applyMutation(
			putNote({
				expectedVersion: first.entityVersion,
				note: { ...putNote().note, text: 'Server revision\n', thoughts: [{ id: 'thought-2', end: 16 }] }
			})
		);

		expect(() => database.applyMutation(putNote({ expectedVersion: 1 }))).toThrow(
			MutationConflictError
		);
		expect(database.snapshot().notes[0]).toMatchObject({ text: 'Server revision\n', serverVersion: 2 });
	});

	it('keeps a content-free tombstone so offline state cannot resurrect a deleted note', async () => {
		const database = await createDatabase();
		database.applyMutation(putFolder());
		const created = database.applyMutation(putNote());

		const deleted = database.applyMutation({
			mutationId: crypto.randomUUID(),
			type: 'delete-note',
			entityId: 'note-1',
			expectedVersion: created.entityVersion
		});

		expect(deleted).toMatchObject({ status: 'applied', entityVersion: 2 });
		expect(database.snapshot().notes).toEqual([]);
		expect(database.inspectTombstone('note', 'note-1')).toEqual({
			entityType: 'note',
			entityId: 'note-1',
			serverVersion: 2,
			deletedAt: '2026-07-14T01:00:00.000Z'
		});
		expect(() => database.applyMutation(putNote({ expectedVersion: 0 }))).toThrow(
			MutationConflictError
		);
	});
});
