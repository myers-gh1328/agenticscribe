import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
	FolderHierarchyError,
	FolderNameError,
	NotebookStore,
	noteLabel,
	type CommittedNote
} from './notebook-store';

const stores: NotebookStore[] = [];

function createStore() {
	const store = new NotebookStore({
		databaseName: `agenticscribe-${crypto.randomUUID()}`,
		now: () => '2026-07-13T12:00:00.000Z'
	});
	stores.push(store);
	return store;
}

afterEach(async () => {
	await Promise.all(stores.splice(0).map((store) => store.deleteDatabase()));
});

describe('NotebookStore', () => {
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
