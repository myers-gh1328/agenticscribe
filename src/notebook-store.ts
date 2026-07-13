import Dexie, { type EntityTable } from 'dexie';

export const SCRATCHPAD = 'scratchpad';
export const MAX_FOLDER_DEPTH = 8;
const ROOT = '\u0000root';

export interface ThoughtBoundary {
	id: string;
	end: number;
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

class NotebookDatabase extends Dexie {
	notes!: EntityTable<StoredNote, 'id'>;
	folders!: EntityTable<FolderRecord, 'id'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores({
			notes: '&id, location, updatedAt',
			folders: '&id, parentId, &[parentKey+normalizedName]'
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

	async commitNote(note: CommittedNote) {
		validateCommittedNote(note);
		return this.#database.transaction('rw', this.#database.notes, this.#database.folders, async () => {
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
			return structuredClone(stored);
		});
	}

	async createFolder(input: FolderInput) {
		if (!input.id || input.id.includes('\u0000') || input.id === SCRATCHPAD) {
			throw new FolderHierarchyError('Folder ID is invalid.');
		}
		const normalized = normalizeFolderName(input.name);
		return this.#database.transaction('rw', this.#database.folders, async () => {
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
			const { parentKey: _parentKey, normalizedName: _normalizedName, ...folder } = record;
			return structuredClone(folder);
		});
	}

	async renameFolder(id: string, name: string) {
		const normalized = normalizeFolderName(name);
		return this.#database.transaction('rw', this.#database.folders, async () => {
			const previous = await this.#database.folders.get(id);
			if (!previous) throw new FolderHierarchyError('Folder does not exist.');
			const next: FolderRecord = { ...previous, ...normalized, updatedAt: this.#now() };
			await this.#database.folders.put(next);
			const { parentKey: _parentKey, normalizedName: _normalizedName, ...folder } = next;
			return structuredClone(folder);
		});
	}

	async moveNote(id: string, location: string) {
		return this.#database.transaction('rw', this.#database.notes, this.#database.folders, async () => {
			const note = await this.#database.notes.get(id);
			if (!note) throw new Error('Note does not exist.');
			if (location !== SCRATCHPAD && !(await this.#database.folders.get(location))) {
				throw new FolderHierarchyError('Folder does not exist.');
			}
			if (note.location === location) return structuredClone(note);
			const moved = { ...note, location, revision: note.revision + 1, updatedAt: this.#now() };
			await this.#database.notes.put(moved);
			return structuredClone(moved);
		});
	}

	async deleteNote(id: string) {
		await this.#database.notes.delete(id);
	}

	async deleteDatabase() {
		this.#database.close();
		await Dexie.delete(this.#databaseName);
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
