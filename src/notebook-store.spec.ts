import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
	FolderHierarchyError,
	FolderNameError,
	NotebookConflictError,
	NotebookStore,
	SCRATCHPAD,
	noteLabel,
	type CommittedNote,
	type NotebookMutation
} from './notebook-store';

const stores: NotebookStore[] = [];

function createStore(databaseName = `agenticscribe-${crypto.randomUUID()}`) {
	const store = new NotebookStore({
		databaseName,
		now: () => '2026-07-13T12:00:00.000Z'
	});
	stores.push(store);
	return store;
}

afterEach(async () => {
	await Promise.all(stores.splice(0).map((store) => store.deleteDatabase()));
});

describe('NotebookStore', () => {
	it('persists unfinished drafts without clearing newer text', async () => {
		const store = createStore();
		await store.saveDraft('note-draft', 'unfinished', SCRATCHPAD);

		expect(await store.listDrafts()).toEqual([
		{
			noteId: 'note-draft',
			text: 'unfinished',
			location: SCRATCHPAD,
			updatedAt: '2026-07-13T12:00:00.000Z'
		}
	]);

		await store.clearDraft('note-draft', 'older text');
		expect(await store.listDrafts()).toHaveLength(1);

		await store.clearDraft('note-draft', 'unfinished');
		expect(await store.listDrafts()).toEqual([]);
	});

	it('deleting an uncommitted note also deletes its local draft', async () => {
		const store = createStore();
		await store.saveDraft('note-draft', 'unfinished', SCRATCHPAD);

		await store.deleteNote('note-draft');

		expect(await store.listDrafts()).toEqual([]);
	});

	it('hydrates clean folders and notes from the authoritative snapshot', async () => {
		const store = createStore();
		await store.synchronize({
			async snapshot() {
				return {
					schemaVersion: 1,
					folders: [{ id: 'work', name: ' Work ', parentId: null, serverVersion: 4, createdAt: 'created', updatedAt: 'updated' }],
					notes: [{
						id: 'note-remote',
						text: 'Remote thought\n',
						thoughts: [{ id: 'thought-remote', end: 15 }],
						location: 'work',
						serverVersion: 7,
						createdAt: 'created',
						updatedAt: 'updated'
					}]
				};
			},
			async applyMutation() {
				throw new Error('No mutation expected.');
			}
		});

		expect(await store.listFolders()).toEqual([
			expect.objectContaining({ id: 'work', name: 'Work', parentId: null })
		]);
		expect(await store.loadNote('note-remote')).toMatchObject({ text: 'Remote thought\n' });
		expect(await store.syncState('note', 'note-remote')).toMatchObject({
			serverVersion: 7,
			status: 'clean'
		});
	});

	it('migrates version-one browser data by sending folders before their notes', async () => {
		const databaseName = `agenticscribe-legacy-${crypto.randomUUID()}`;
		const legacy = new Dexie(databaseName);
		legacy.version(1).stores({
			notes: '&id, location, updatedAt',
			folders: '&id, parentId, &[parentKey+normalizedName]'
		});
		await legacy.table('notes').add({
			id: 'legacy-note', text: 'Legacy thought\n', thoughts: [{ id: 'legacy-thought', end: 15 }],
			location: 'legacy-folder', revision: 1, createdAt: 'created', updatedAt: 'updated'
		});
		await legacy.table('folders').add({
			id: 'legacy-folder', name: 'Legacy', normalizedName: 'legacy', parentId: null,
			parentKey: '\u0000root', createdAt: 'created', updatedAt: 'updated'
		});
		legacy.close();

		const store = createStore(databaseName);
		const applied: NotebookMutation[] = [];
		await store.synchronize({
			async snapshot() {
				return { schemaVersion: 1, notes: [], folders: [] };
			},
			async applyMutation(mutation) {
				applied.push(mutation);
				return { status: 'applied', entityVersion: 1 };
			}
		});

		expect(applied.map((mutation) => mutation.type)).toEqual(['put-folder', 'put-note']);
		expect(await store.pendingMutations()).toEqual([]);
	});

	it('rebases a newer local commit when an older in-flight mutation is acknowledged', async () => {
		const store = createStore();
		const first = {
			id: 'note-race', text: 'First\n', thoughts: [{ id: 'thought-1', end: 6 }], location: 'scratchpad'
		};
		await store.commitNote(first);
		await store.synchronize({
			async snapshot() { return { schemaVersion: 1, notes: [], folders: [] }; },
			async applyMutation() { return { status: 'applied', entityVersion: 1 }; }
		});
		await store.commitNote({ ...first, text: 'Second\n', thoughts: [{ id: 'thought-2', end: 7 }] });

		let release!: () => void;
		const paused = new Promise<void>((resolve) => { release = resolve; });
		let started!: () => void;
		const mutationStarted = new Promise<void>((resolve) => { started = resolve; });
		const synchronizing = store.synchronize({
			async snapshot() { return { schemaVersion: 1, notes: [], folders: [] }; },
			async applyMutation() {
				started();
				await paused;
				return { status: 'applied', entityVersion: 2 };
			}
		});
		await mutationStarted;
		await store.commitNote({ ...first, text: 'Third\n', thoughts: [{ id: 'thought-3', end: 6 }] });
		release();
		await synchronizing;

		expect(await store.pendingMutations()).toEqual([
			expect.objectContaining({
				type: 'put-note',
				expectedVersion: 2,
				note: expect.objectContaining({ text: 'Third\n' })
			})
		]);
		expect(await store.syncState('note', 'note-race')).toMatchObject({
			serverVersion: 2,
			status: 'pending'
		});
	});
	it('atomically queues and coalesces offline note commits until the server acknowledges them', async () => {
		const store = createStore();
		await store.commitNote({
			id: 'note-1',
			text: 'First offline thought\n',
			thoughts: [{ id: 'thought-1', end: 22 }],
			location: 'scratchpad'
		});
		await store.commitNote({
			id: 'note-1',
			text: 'First offline thought\nSecond offline thought\n',
			thoughts: [
				{ id: 'thought-1', end: 22 },
				{ id: 'thought-2', end: 45 }
			],
			location: 'scratchpad'
		});

		const pending = await store.pendingMutations();
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({
			type: 'put-note',
			entityId: 'note-1',
			expectedVersion: 0,
			note: { text: 'First offline thought\nSecond offline thought\n' }
		});

		const applied: NotebookMutation[] = [];
		await store.synchronize({
			async snapshot() {
				return { schemaVersion: 1, notes: [], folders: [] };
			},
			async applyMutation(mutation) {
				applied.push(mutation);
				return { status: 'applied', entityVersion: 1 };
			}
		});

		expect(applied).toHaveLength(1);
		expect(await store.pendingMutations()).toEqual([]);
		expect(await store.syncState('note', 'note-1')).toEqual({
			entityType: 'note',
			entityId: 'note-1',
			serverVersion: 1,
			status: 'clean'
		});
	});

	it('keeps offline work queued when synchronization is unavailable', async () => {
		const store = createStore();
		await store.commitNote({
			id: 'note-offline',
			text: 'Keep offline\n',
			thoughts: [{ id: 'thought-offline', end: 13 }],
			location: 'scratchpad'
		});

		await expect(
			store.synchronize({
				async snapshot() {
					throw new TypeError('offline');
				},
				async applyMutation() {
					throw new TypeError('offline');
				}
			})
		).rejects.toThrow('offline');

		expect(await store.loadNote('note-offline')).toMatchObject({ text: 'Keep offline\n' });
		expect(await store.pendingMutations()).toHaveLength(1);
	});

	it('preserves a local edit in an explicit conflict record when the server is newer', async () => {
		const store = createStore();
		const original = {
			id: 'note-conflict', text: 'Original\n', thoughts: [{ id: 'thought-original', end: 9 }], location: 'scratchpad'
		};
		await store.commitNote(original);
		await store.synchronize({
			async snapshot() { return { schemaVersion: 1, notes: [], folders: [] }; },
			async applyMutation() { return { status: 'applied', entityVersion: 1 }; }
		});
		await store.commitNote({
			...original,
			text: 'Local edit\n',
			thoughts: [{ id: 'thought-local', end: 11 }]
		});
		const conflict = Object.assign(new Error('conflict'), {
			status: 409,
			current: { serverVersion: 2, deleted: false }
		});

		await expect(store.synchronize({
			async snapshot() { return { schemaVersion: 1, notes: [], folders: [] }; },
			async applyMutation() { throw conflict; }
		})).rejects.toBeInstanceOf(NotebookConflictError);

		expect(await store.pendingMutations()).toEqual([]);
		expect(await store.syncState('note', 'note-conflict')).toMatchObject({ status: 'conflict' });
		expect(await store.inspectConflict('note', 'note-conflict')).toMatchObject({
			mutation: expect.objectContaining({ type: 'put-note' }),
			remote: { serverVersion: 2, deleted: false }
		});
		expect(await store.loadNote('note-conflict')).toMatchObject({ text: 'Local edit\n' });
	});

	it('keeps deleted content in a local tombstone until the server acknowledges deletion', async () => {
		const store = createStore();
		await store.commitNote({
			id: 'note-delete',
			text: 'Delete after sync\n',
			thoughts: [{ id: 'thought-delete', end: 18 }],
			location: 'scratchpad'
		});
		await store.synchronize({
			async snapshot() {
				return { schemaVersion: 1, notes: [], folders: [] };
			},
			async applyMutation() {
				return { status: 'applied', entityVersion: 1 };
			}
		});

		await store.deleteNote('note-delete');

		expect(await store.loadNote('note-delete')).toBeUndefined();
		expect(await store.pendingMutations()).toEqual([
			expect.objectContaining({
				type: 'delete-note',
				entityId: 'note-delete',
				expectedVersion: 1
			})
		]);
		expect(await store.inspectTombstone('note', 'note-delete')).toMatchObject({
			entityId: 'note-delete',
			previous: { text: 'Delete after sync\n' }
		});
	});

	it('persists only explicitly committed note content', async () => {
		const store = createStore();
		const committed: CommittedNote = {
			id: 'note-1',
			text: 'First thought\n',
			thoughts: [{ id: 'thought-1', end: 14 }],
			location: 'scratchpad'
		};

		await store.commitNote(committed);

		expect(await store.loadNote('note-1')).toMatchObject({
			...committed,
			revision: 1
		});
		expect(await store.listNotes()).toHaveLength(1);
	});

	it('updates one note without overwriting another note', async () => {
		const store = createStore();
		await store.commitNote({
			id: 'note-1',
			text: 'First\n',
			thoughts: [{ id: 'thought-1', end: 6 }],
			location: 'scratchpad'
		});
		await store.commitNote({
			id: 'note-2',
			text: 'Second\n',
			thoughts: [{ id: 'thought-2', end: 7 }],
			location: 'scratchpad'
		});

		await store.commitNote({
			id: 'note-1',
			text: 'First revised\n',
			thoughts: [{ id: 'thought-1', end: 14 }],
			location: 'scratchpad'
		});

		expect(await store.loadNote('note-1')).toMatchObject({ text: 'First revised\n', revision: 2 });
		expect(await store.loadNote('note-2')).toMatchObject({ text: 'Second\n', revision: 1 });
	});

	it('creates, nests, and renames folders while rejecting invalid hierarchy', async () => {
		const store = createStore();
		await store.createFolder({ id: 'work', name: 'Work', parentId: null });
		await store.createFolder({ id: 'clients', name: 'Clients', parentId: 'work' });
		await store.renameFolder('clients', 'Customers');

		expect(await store.listFolders()).toEqual([
			expect.objectContaining({ id: 'clients', name: 'Customers', parentId: 'work' }),
			expect.objectContaining({ id: 'work', name: 'Work', parentId: null })
		]);
		await expect(
			store.createFolder({ id: 'orphan', name: 'Orphan', parentId: 'missing' })
		).rejects.toBeInstanceOf(FolderHierarchyError);
		await expect(
			store.createFolder({ id: 'unsafe', name: '../unsafe', parentId: null })
		).rejects.toBeInstanceOf(FolderNameError);
	});

	it('moves and permanently deletes only the selected note', async () => {
		const store = createStore();
		await store.createFolder({ id: 'work', name: 'Work', parentId: null });
		await store.commitNote({
			id: 'note-1',
			text: 'Move me\n',
			thoughts: [{ id: 'thought-1', end: 8 }],
			location: 'scratchpad'
		});
		await store.commitNote({
			id: 'note-2',
			text: 'Keep me\n',
			thoughts: [{ id: 'thought-2', end: 8 }],
			location: 'scratchpad'
		});

		await store.moveNote('note-1', 'work');
		expect(await store.loadNote('note-1')).toMatchObject({ location: 'work', revision: 2 });

		await store.deleteNote('note-1');
		expect(await store.loadNote('note-1')).toBeUndefined();
		expect(await store.loadNote('note-2')).toMatchObject({ text: 'Keep me\n' });
	});

	it('derives a label from the first nonempty line and falls back for blank text', () => {
		expect(noteLabel('\n  Meeting notes  \nNext')).toBe('Meeting notes');
		expect(noteLabel('   \n')).toBe('Untitled note');
	});

	it('rejects malformed boundaries and uncommitted trailing text', async () => {
		const store = createStore();
		await expect(
			store.commitNote({ id: '', text: '', thoughts: [], location: 'scratchpad' })
		).rejects.toThrow('needs a thought');
		await expect(
			store.commitNote({
				id: 'note-1',
				text: 'Saved\ntrailing',
				thoughts: [{ id: 'thought-1', end: 6 }],
				location: 'scratchpad'
			})
		).rejects.toThrow('Uncommitted text');
		await expect(
			store.commitNote({
				id: 'note-1',
				text: 'Saved\n',
				thoughts: [
					{ id: 'thought-1', end: 3 },
					{ id: 'thought-1', end: 6 }
				],
				location: 'scratchpad'
			})
		).rejects.toThrow('boundaries are invalid');
	});

	it('rejects reserved, duplicate, missing, and over-deep folder relationships', async () => {
		const store = createStore();
		await expect(
			store.createFolder({ id: 'scratchpad', name: 'Reserved', parentId: null })
		).rejects.toBeInstanceOf(FolderHierarchyError);
		await store.createFolder({ id: 'root', name: 'Root', parentId: null });
		await expect(
			store.createFolder({ id: 'root', name: 'Duplicate ID', parentId: null })
		).rejects.toBeInstanceOf(FolderHierarchyError);
		await expect(store.renameFolder('missing', 'Missing')).rejects.toBeInstanceOf(
			FolderHierarchyError
		);

		let parentId: string | null = 'root';
		for (let depth = 2; depth <= 8; depth += 1) {
			const id = `depth-${depth}`;
			await store.createFolder({ id, name: `Depth ${depth}`, parentId });
			parentId = id;
		}
		await expect(
			store.createFolder({ id: 'too-deep', name: 'Too deep', parentId })
		).rejects.toBeInstanceOf(FolderHierarchyError);
	});

	it('rejects missing note and folder targets without changing saved content', async () => {
		const store = createStore();
		await expect(store.moveNote('missing-note', 'scratchpad')).rejects.toThrow('Note does not exist');
		await expect(
			store.commitNote({
				id: 'bad-location',
				text: 'Saved\n',
				thoughts: [{ id: 'thought-1', end: 6 }],
				location: 'missing-folder'
			})
		).rejects.toBeInstanceOf(FolderHierarchyError);
		await store.commitNote({
			id: 'note-1',
			text: 'Saved\n',
			thoughts: [{ id: 'thought-1', end: 6 }],
			location: 'scratchpad'
		});
		await expect(store.moveNote('note-1', 'missing-folder')).rejects.toBeInstanceOf(
			FolderHierarchyError
		);
		const unchanged = await store.moveNote('note-1', 'scratchpad');
		expect(unchanged).toMatchObject({ revision: 1, location: 'scratchpad' });
	});
});
