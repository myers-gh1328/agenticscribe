import Dexie, { type EntityTable } from 'dexie';

export const SCRATCHPAD = 'scratchpad';
export const MAX_FOLDER_DEPTH = 8;
const ROOT = '\u0000root';

export interface ThoughtBoundary {
	id: string;
	end: number;
	originalText?: string;
}

export interface CommittedNote {
	id: string;
	text: string;
	thoughts: ThoughtBoundary[];
	location: string;
}

export interface StoredNote extends CommittedNote {
	revision: number;
	createdAt: string;
	updatedAt: string;
}

export interface FolderInput {
	id: string;
	name: string;
	parentId: string | null;
}

export interface StoredFolder extends FolderInput {
	createdAt: string;
	updatedAt: string;
}

interface FolderRecord extends StoredFolder {
	parentKey: string;
	normalizedName: string;
}

type EntityType = 'note' | 'folder';

interface SyncRecord {
	key: string;
	entityType: EntityType;
	entityId: string;
	serverVersion: number;
	status: 'clean' | 'pending' | 'conflict';
}

export type NotebookMutation =
	| {
			mutationId: string;
			type: 'put-note';
			entityId: string;
			expectedVersion: number;
			note: CommittedNote;
	  }
	| {
			mutationId: string;
			type: 'put-folder';
			entityId: string;
			expectedVersion: number;
			folder: FolderInput;
	  }
	| {
			mutationId: string;
			type: 'delete-note';
			entityId: string;
			expectedVersion: number;
	  };

interface OutboxRecord {
	key: string;
	createdAt: string;
	mutation: NotebookMutation;
}

interface TombstoneRecord {
	key: string;
	entityType: EntityType;
	entityId: string;
	previous: StoredNote | StoredFolder;
	createdAt: string;
}

interface ConflictRecord {
	key: string;
	entityType: EntityType;
	entityId: string;
	mutation: NotebookMutation;
	remote: unknown;
	createdAt: string;
}

export interface StoredDraft {
	noteId: string;
	text: string;
	location: string;
	updatedAt: string;
}

export interface NotebookSnapshot {
	schemaVersion: number;
	notes: Array<CommittedNote & { serverVersion: number; createdAt: string; updatedAt: string }>;
	folders: Array<FolderInput & { serverVersion: number; createdAt: string; updatedAt: string }>;
}

export interface NotebookRemote {
	snapshot(): Promise<NotebookSnapshot>;
	applyMutation(mutation: NotebookMutation): Promise<{ status: string; entityVersion: number }>;
}

interface NotebookStoreOptions {
	databaseName: string;
	now?: () => string;
}

export class FolderNameError extends Error {
	constructor() {
		super('Folder names must be 1–120 characters and cannot contain controls, /, or \\.');
		this.name = 'FolderNameError';
	}
}

export class FolderHierarchyError extends Error {
	constructor(message = `Folders cannot be deeper than ${MAX_FOLDER_DEPTH} levels.`) {
		super(message);
		this.name = 'FolderHierarchyError';
	}
}

export class NotebookConflictError extends Error {
	readonly entityType: EntityType;
	readonly entityId: string;

	constructor(entityType: EntityType, entityId: string) {
		super('The server has a newer version. The local copy was preserved for conflict resolution.');
		this.name = 'NotebookConflictError';
		this.entityType = entityType;
		this.entityId = entityId;
	}
}

class NotebookDatabase extends Dexie {
	notes!: EntityTable<StoredNote, 'id'>;
	folders!: EntityTable<FolderRecord, 'id'>;
	sync!: EntityTable<SyncRecord, 'key'>;
	outbox!: EntityTable<OutboxRecord, 'key'>;
	tombstones!: EntityTable<TombstoneRecord, 'key'>;
	conflicts!: EntityTable<ConflictRecord, 'key'>;
	drafts!: EntityTable<StoredDraft, 'noteId'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores({
			notes: '&id, location, updatedAt',
			folders: '&id, parentId, &[parentKey+normalizedName]'
		});
		this.version(2).stores({
			notes: '&id, location, updatedAt',
			folders: '&id, parentId, &[parentKey+normalizedName]',
			sync: '&key, [entityType+entityId], status',
			outbox: '&key, createdAt',
			tombstones: '&key, [entityType+entityId]',
			conflicts: '&key, [entityType+entityId]'
		});
		this.version(3).stores({
			notes: '&id, location, updatedAt',
			folders: '&id, parentId, &[parentKey+normalizedName]',
			sync: '&key, [entityType+entityId], status',
			outbox: '&key, createdAt',
			tombstones: '&key, [entityType+entityId]',
			conflicts: '&key, [entityType+entityId]',
			drafts: '&noteId, updatedAt'
		});
	}
}

function normalizeFolderName(value: string) {
	const name = value.normalize('NFC').trim();
	const invalid =
		name.length === 0 ||
		[...name].length > 120 ||
		[...name].some((character) => {
			const codePoint = character.codePointAt(0)!;
			return (
				codePoint <= 0x1f ||
				(codePoint >= 0x7f && codePoint <= 0x9f) ||
				character === '/' ||
				character === '\\'
			);
		});
	if (invalid) throw new FolderNameError();
	return { name, normalizedName: name.toLocaleLowerCase('und') };
}

function validateCommittedNote(note: CommittedNote) {
	if (!note.id || note.thoughts.length === 0) throw new Error('A committed note needs a thought.');
	let previousEnd = 0;
	const thoughtIds = new Set<string>();
	for (const thought of note.thoughts) {
		if (
			!thought.id ||
			thoughtIds.has(thought.id) ||
			!Number.isInteger(thought.end) ||
			thought.end <= previousEnd ||
			thought.end > note.text.length
		) {
			throw new Error('Thought boundaries are invalid.');
		}
		thoughtIds.add(thought.id);
		previousEnd = thought.end;
	}
	if (previousEnd !== note.text.length) throw new Error('Uncommitted text cannot be persisted.');
}

export function noteLabel(text: string) {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean) ?? 'Untitled note';
}

export class NotebookStore {
	readonly #database: NotebookDatabase;
	readonly #databaseName: string;
	readonly #now: () => string;

	constructor(options: NotebookStoreOptions) {
		this.#databaseName = options.databaseName;
		this.#database = new NotebookDatabase(options.databaseName);
		this.#now = options.now ?? (() => new Date().toISOString());
	}

	async loadNote(id: string) {
		const note = await this.#database.notes.get(id);
		return note ? structuredClone(note) : undefined;
	}

	async listNotes() {
		const notes = await this.#database.notes.orderBy('updatedAt').reverse().toArray();
		return structuredClone(notes);
	}

	async listFolders() {
		const folders = await this.#database.folders.toArray();
		return folders
			.map(({ parentKey: _parentKey, normalizedName: _normalizedName, ...folder }) => folder)
			.sort((left, right) => left.name.localeCompare(right.name));
	}

	async listDrafts() {
		return structuredClone(await this.#database.drafts.toArray());
	}

	async saveDraft(noteId: string, text: string, location: string) {
		if (!noteId) throw new Error('A draft needs a note ID.');
		await this.#database.drafts.put({ noteId, text, location, updatedAt: this.#now() });
	}

	async clearDraft(noteId: string, expectedText?: string) {
		await this.#database.transaction('rw', this.#database.drafts, async () => {
			const draft = await this.#database.drafts.get(noteId);
			if (!draft || (expectedText !== undefined && draft.text !== expectedText)) return;
			await this.#database.drafts.delete(noteId);
		});
	}

	async commitNote(note: CommittedNote) {
		validateCommittedNote(note);
		return this.#database.transaction(
			'rw',
			[this.#database.notes, this.#database.folders, this.#database.sync, this.#database.outbox],
			async () => {
			if (note.location !== SCRATCHPAD && !(await this.#database.folders.get(note.location))) {
				throw new FolderHierarchyError('Folder does not exist.');
			}
			const previous = await this.#database.notes.get(note.id);
			const now = this.#now();
			const stored: StoredNote = {
				...structuredClone(note),
				revision: (previous?.revision ?? 0) + 1,
				createdAt: previous?.createdAt ?? now,
				updatedAt: now
			};
			await this.#database.notes.put(stored);
			await this.#queueMutation('note', note.id, {
				mutationId: crypto.randomUUID(),
				type: 'put-note',
				entityId: note.id,
				expectedVersion: 0,
				note: structuredClone(note)
			});
			return structuredClone(stored);
			}
		);
	}

	async createFolder(input: FolderInput) {
		if (!input.id || input.id.includes('\u0000') || input.id === SCRATCHPAD) {
			throw new FolderHierarchyError('Folder ID is invalid.');
		}
		const normalized = normalizeFolderName(input.name);
		return this.#database.transaction('rw', [this.#database.folders, this.#database.sync, this.#database.outbox], async () => {
			if (await this.#database.folders.get(input.id)) {
				throw new FolderHierarchyError('Folder already exists.');
			}
			if (input.parentId && !(await this.#database.folders.get(input.parentId))) {
				throw new FolderHierarchyError('Folder does not exist.');
			}
			await this.#assertDepth(input.parentId);
			const now = this.#now();
			const record: FolderRecord = {
				...input,
				...normalized,
				parentKey: input.parentId ?? ROOT,
				createdAt: now,
				updatedAt: now
			};
			await this.#database.folders.add(record);
			await this.#queueMutation('folder', input.id, {
				mutationId: crypto.randomUUID(),
				type: 'put-folder',
				entityId: input.id,
				expectedVersion: 0,
				folder: structuredClone(input)
			});
			const { parentKey: _parentKey, normalizedName: _normalizedName, ...folder } = record;
			return structuredClone(folder);
		});
	}

	async renameFolder(id: string, name: string) {
		const normalized = normalizeFolderName(name);
		return this.#database.transaction('rw', [this.#database.folders, this.#database.sync, this.#database.outbox], async () => {
			const previous = await this.#database.folders.get(id);
			if (!previous) throw new FolderHierarchyError('Folder does not exist.');
			const next: FolderRecord = { ...previous, ...normalized, updatedAt: this.#now() };
			await this.#database.folders.put(next);
			await this.#queueMutation('folder', id, {
				mutationId: crypto.randomUUID(),
				type: 'put-folder',
				entityId: id,
				expectedVersion: 0,
				folder: { id, name: next.name, parentId: next.parentId }
			});
			const { parentKey: _parentKey, normalizedName: _normalizedName, ...folder } = next;
			return structuredClone(folder);
		});
	}

	async moveNote(id: string, location: string) {
		return this.#database.transaction('rw', [this.#database.notes, this.#database.folders, this.#database.sync, this.#database.outbox], async () => {
			const note = await this.#database.notes.get(id);
			if (!note) throw new Error('Note does not exist.');
			if (location !== SCRATCHPAD && !(await this.#database.folders.get(location))) {
				throw new FolderHierarchyError('Folder does not exist.');
			}
			if (note.location === location) return structuredClone(note);
			const moved = { ...note, location, revision: note.revision + 1, updatedAt: this.#now() };
			await this.#database.notes.put(moved);
			await this.#queueMutation('note', id, {
				mutationId: crypto.randomUUID(),
				type: 'put-note',
				entityId: id,
				expectedVersion: 0,
				note: { id, text: moved.text, thoughts: moved.thoughts, location: moved.location }
			});
			return structuredClone(moved);
		});
	}

	async deleteNote(id: string) {
		await this.#database.transaction(
			'rw',
			[this.#database.notes, this.#database.sync, this.#database.outbox, this.#database.tombstones, this.#database.drafts],
			async () => {
				await this.#database.drafts.delete(id);
				const previous = await this.#database.notes.get(id);
				if (!previous) return;
				const sync = await this.#database.sync.get(entityKey('note', id));
				await this.#database.notes.delete(id);
				if (!sync?.serverVersion) {
					await this.#database.outbox.delete(entityKey('note', id));
					await this.#database.sync.delete(entityKey('note', id));
					return;
				}
				await this.#database.tombstones.put({
					key: entityKey('note', id),
					entityType: 'note',
					entityId: id,
					previous: structuredClone(previous),
					createdAt: this.#now()
				});
				await this.#queueMutation('note', id, {
					mutationId: crypto.randomUUID(),
					type: 'delete-note',
					entityId: id,
					expectedVersion: sync.serverVersion
				});
			}
		);
	}

	async pendingMutations() {
		const records = await this.#database.outbox.orderBy('createdAt').toArray();
		return records.map((record) => structuredClone(record.mutation));
	}

	async syncState(entityType: EntityType, entityId: string) {
		const record = await this.#database.sync.get(entityKey(entityType, entityId));
		if (!record) return undefined;
		const { key: _key, ...state } = record;
		return structuredClone(state);
	}

	async inspectTombstone(entityType: EntityType, entityId: string) {
		const record = await this.#database.tombstones.get(entityKey(entityType, entityId));
		if (!record) return undefined;
		const { key: _key, ...tombstone } = record;
		return structuredClone(tombstone);
	}

	async inspectConflict(entityType: EntityType, entityId: string) {
		const record = await this.#database.conflicts.get(entityKey(entityType, entityId));
		if (!record) return undefined;
		const { key: _key, ...conflict } = record;
		return structuredClone(conflict);
	}

	async synchronize(remote: NotebookRemote) {
		await this.#mergeSnapshot(await remote.snapshot());
		await this.#queueLegacyEntities();
		const records = await this.#database.outbox.orderBy('createdAt').toArray();
		for (const record of sortOutbox(records)) {
			try {
				const result = await remote.applyMutation(structuredClone(record.mutation));
				await this.#acknowledge(record, result.entityVersion);
			} catch (error) {
				if (!isRemoteConflict(error)) throw error;
				await this.#recordConflict(record, error.current);
				const [entityType, entityId] = splitEntityKey(record.key);
				throw new NotebookConflictError(entityType, entityId);
			}
		}
		await this.#mergeSnapshot(await remote.snapshot());
	}

	async #recordConflict(record: OutboxRecord, remote: unknown) {
		await this.#database.transaction(
			'rw',
			[this.#database.outbox, this.#database.sync, this.#database.conflicts],
			async () => {
				const current = await this.#database.outbox.get(record.key);
				if (current?.mutation.mutationId !== record.mutation.mutationId) return;
				const [entityType, entityId] = splitEntityKey(record.key);
				await this.#database.conflicts.put({
					key: record.key,
					entityType,
					entityId,
					mutation: structuredClone(record.mutation),
					remote: structuredClone(remote),
					createdAt: this.#now()
				});
				await this.#database.outbox.delete(record.key);
				await this.#database.sync.put({
					key: record.key,
					entityType,
					entityId,
					serverVersion: record.mutation.expectedVersion,
					status: 'conflict'
				});
			}
		);
	}

	async deleteDatabase() {
		this.#database.close();
		await Dexie.delete(this.#databaseName);
	}

	async #queueMutation(entityType: EntityType, entityId: string, mutation: NotebookMutation) {
		const key = entityKey(entityType, entityId);
		const sync = await this.#database.sync.get(key);
		mutation.expectedVersion = sync?.serverVersion ?? 0;
		await this.#database.outbox.put({ key, createdAt: this.#now(), mutation });
		await this.#database.sync.put({
			key,
			entityType,
			entityId,
			serverVersion: sync?.serverVersion ?? 0,
			status: 'pending'
		});
	}

	async #acknowledge(record: OutboxRecord, serverVersion: number) {
		await this.#database.transaction(
			'rw',
			[this.#database.outbox, this.#database.sync, this.#database.tombstones],
			async () => {
				const current = await this.#database.outbox.get(record.key);
				const [entityType, entityId] = splitEntityKey(record.key);
				if (current?.mutation.mutationId === record.mutation.mutationId) {
					await this.#database.outbox.delete(record.key);
					await this.#database.tombstones.delete(record.key);
					await this.#database.sync.put({
						key: record.key,
						entityType,
						entityId,
						serverVersion,
						status: 'clean'
					});
				} else if (current) {
					current.mutation.expectedVersion = serverVersion;
					await this.#database.outbox.put(current);
					await this.#database.sync.put({
						key: record.key,
						entityType,
						entityId,
						serverVersion,
						status: 'pending'
					});
				}
			}
		);
	}

	async #mergeSnapshot(snapshot: NotebookSnapshot) {
		await this.#database.transaction(
			'rw',
			[this.#database.notes, this.#database.folders, this.#database.sync, this.#database.outbox, this.#database.conflicts],
			async () => {
				for (const folder of snapshot.folders) {
					const key = entityKey('folder', folder.id);
					if ((await this.#database.outbox.get(key)) || (await this.#database.conflicts.get(key))) continue;
					const normalized = normalizeFolderName(folder.name);
					await this.#database.folders.put({
						id: folder.id,
						name: normalized.name,
						normalizedName: normalized.normalizedName,
						parentId: folder.parentId,
						parentKey: folder.parentId ?? ROOT,
						createdAt: folder.createdAt,
						updatedAt: folder.updatedAt
					});
					await this.#database.sync.put({ key, entityType: 'folder', entityId: folder.id, serverVersion: folder.serverVersion, status: 'clean' });
				}
				for (const note of snapshot.notes) {
					const key = entityKey('note', note.id);
					if ((await this.#database.outbox.get(key)) || (await this.#database.conflicts.get(key))) continue;
					const previous = await this.#database.notes.get(note.id);
					await this.#database.notes.put({
						id: note.id,
						text: note.text,
						thoughts: note.thoughts,
						location: note.location,
						revision: previous?.revision ?? note.serverVersion,
						createdAt: note.createdAt,
						updatedAt: note.updatedAt
					});
					await this.#database.sync.put({ key, entityType: 'note', entityId: note.id, serverVersion: note.serverVersion, status: 'clean' });
				}
			}
		);
	}

	async #queueLegacyEntities() {
		await this.#database.transaction(
			'rw',
			[this.#database.notes, this.#database.folders, this.#database.sync, this.#database.outbox],
			async () => {
				for (const folder of await this.#database.folders.toArray()) {
					const key = entityKey('folder', folder.id);
					if (!(await this.#database.sync.get(key))) {
						await this.#queueMutation('folder', folder.id, {
							mutationId: crypto.randomUUID(),
							type: 'put-folder',
							entityId: folder.id,
							expectedVersion: 0,
							folder: { id: folder.id, name: folder.name, parentId: folder.parentId }
						});
					}
				}
				for (const note of await this.#database.notes.toArray()) {
					const key = entityKey('note', note.id);
					if (!(await this.#database.sync.get(key))) {
						await this.#queueMutation('note', note.id, {
							mutationId: crypto.randomUUID(),
							type: 'put-note',
							entityId: note.id,
							expectedVersion: 0,
							note: { id: note.id, text: note.text, thoughts: note.thoughts, location: note.location }
						});
					}
				}
			}
		);
	}

	async #assertDepth(parentId: string | null) {
		let depth = 1;
		let cursor = parentId;
		while (cursor) {
			depth += 1;
			if (depth > MAX_FOLDER_DEPTH) throw new FolderHierarchyError();
			cursor = (await this.#database.folders.get(cursor))?.parentId ?? null;
		}
	}
}

function entityKey(entityType: EntityType, entityId: string) {
	return `${entityType}\u0000${entityId}`;
}

function splitEntityKey(key: string): [EntityType, string] {
	const [entityType, entityId] = key.split('\u0000', 2);
	return [entityType as EntityType, entityId!];
}

function sortOutbox(records: OutboxRecord[]) {
	return records.sort((left, right) => {
		const leftType = left.mutation.type === 'put-folder' ? 0 : 1;
		const rightType = right.mutation.type === 'put-folder' ? 0 : 1;
		return leftType - rightType || left.createdAt.localeCompare(right.createdAt);
	});
}

function isRemoteConflict(error: unknown): error is { status: 409; current?: unknown } {
	return typeof error === 'object' && error !== null && 'status' in error && error.status === 409;
}
