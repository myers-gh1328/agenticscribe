import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MAX_NOTE_BYTES = 256 * 1024;
const MAX_FOLDER_NAME_CHARACTERS = 120;
const SCRATCHPAD = 'scratchpad';

export class MutationConflictError extends Error {
	constructor(message, current) {
		super(message);
		this.name = 'MutationConflictError';
		this.current = current;
	}
}

export class MutationValidationError extends Error {
	constructor(message) {
		super(message);
		this.name = 'MutationValidationError';
	}
}

export function openNotebookDatabase({ path, now = () => new Date().toISOString() }) {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const sqlite = new DatabaseSync(path);
	chmodSync(path, 0o600);
	sqlite.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA foreign_keys = ON;
		PRAGMA busy_timeout = 5000;
		CREATE TABLE IF NOT EXISTS metadata (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		) STRICT;
		INSERT OR IGNORE INTO metadata(key, value) VALUES ('schema_version', '1');
		CREATE TABLE IF NOT EXISTS folders (
			owner_id TEXT NOT NULL,
			id TEXT NOT NULL,
			name TEXT NOT NULL,
			parent_id TEXT,
			server_version INTEGER NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			deleted_at TEXT,
			PRIMARY KEY (owner_id, id)
		) STRICT;
		CREATE TABLE IF NOT EXISTS notes (
			owner_id TEXT NOT NULL,
			id TEXT NOT NULL,
			text TEXT NOT NULL,
			thoughts_json TEXT NOT NULL,
			location TEXT NOT NULL,
			server_version INTEGER NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			deleted_at TEXT,
			PRIMARY KEY (owner_id, id)
		) STRICT;
		CREATE TABLE IF NOT EXISTS mutation_receipts (
			owner_id TEXT NOT NULL,
			mutation_id TEXT NOT NULL,
			request_hash TEXT NOT NULL,
			response_json TEXT NOT NULL,
			created_at TEXT NOT NULL,
			PRIMARY KEY (owner_id, mutation_id)
		) STRICT;
	`);
	if (!sqlite.prepare('PRAGMA table_info(notes)').all().some((column) => column.name === 'final_text')) {
		sqlite.exec('ALTER TABLE notes ADD COLUMN final_text TEXT');
	}
	if (!sqlite.prepare('PRAGMA table_info(notes)').all().some((column) => column.name === 'title')) {
		sqlite.exec("ALTER TABLE notes ADD COLUMN title TEXT NOT NULL DEFAULT 'Untitled note'");
	}
	sqlite.prepare("UPDATE metadata SET value = '3' WHERE key = 'schema_version'").run();

	const statements = {
		receipt: sqlite.prepare(
			'SELECT request_hash, response_json FROM mutation_receipts WHERE owner_id = ? AND mutation_id = ?'
		),
		insertReceipt: sqlite.prepare(
			'INSERT INTO mutation_receipts(owner_id, mutation_id, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)'
		),
		folder: sqlite.prepare('SELECT * FROM folders WHERE owner_id = ? AND id = ?'),
		note: sqlite.prepare('SELECT * FROM notes WHERE owner_id = ? AND id = ?'),
		putFolder: sqlite.prepare(`
			INSERT INTO folders(owner_id, id, name, parent_id, server_version, created_at, updated_at, deleted_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
			ON CONFLICT(owner_id, id) DO UPDATE SET
				name = excluded.name,
				parent_id = excluded.parent_id,
				server_version = excluded.server_version,
				updated_at = excluded.updated_at,
				deleted_at = NULL
		`),
		putNote: sqlite.prepare(`
			INSERT INTO notes(owner_id, id, title, text, final_text, thoughts_json, location, server_version, created_at, updated_at, deleted_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
			ON CONFLICT(owner_id, id) DO UPDATE SET
				title = excluded.title,
				text = excluded.text,
				final_text = excluded.final_text,
				thoughts_json = excluded.thoughts_json,
				location = excluded.location,
				server_version = excluded.server_version,
				updated_at = excluded.updated_at,
				deleted_at = NULL
		`),
		deleteNote: sqlite.prepare(`
			UPDATE notes SET text = '', thoughts_json = '[]', location = ?,
				server_version = ?, updated_at = ?, deleted_at = ? WHERE owner_id = ? AND id = ?
		`),
		activeFolders: sqlite.prepare(
			'SELECT id, name, parent_id, server_version, created_at, updated_at FROM folders WHERE owner_id = ? AND deleted_at IS NULL ORDER BY id'
		),
		activeNotes: sqlite.prepare(
			'SELECT id, title, text, final_text, thoughts_json, location, server_version, created_at, updated_at FROM notes WHERE owner_id = ? AND deleted_at IS NULL ORDER BY id'
		)
	};

	function applyMutation(mutation, ownerId = 'local-owner') {
		validateOwnerId(ownerId);
		validateMutationEnvelope(mutation);
		const requestHash = hashMutation(mutation);
		const receipt = statements.receipt.get(ownerId, mutation.mutationId);
		if (receipt) {
			if (receipt.request_hash !== requestHash) {
				throw new MutationConflictError('Mutation ID was reused with different content.');
			}
			return { ...JSON.parse(receipt.response_json), status: 'duplicate' };
		}

		sqlite.exec('BEGIN IMMEDIATE');
		try {
			const result = applyUnrecordedMutation(mutation, ownerId);
			statements.insertReceipt.run(
				ownerId,
				mutation.mutationId,
				requestHash,
				JSON.stringify(result),
				now()
			);
			sqlite.exec('COMMIT');
			return result;
		} catch (error) {
			sqlite.exec('ROLLBACK');
			throw error;
		}
	}

	function applyUnrecordedMutation(mutation, ownerId) {
		if (mutation.type === 'put-folder') return applyFolder(mutation, ownerId);
		if (mutation.type === 'put-note') return applyNote(mutation, ownerId);
		if (mutation.type === 'delete-note') return applyNoteDeletion(mutation, ownerId);
		throw new MutationValidationError('Mutation type is not supported.');
	}

	function applyFolder(mutation, ownerId) {
		validateFolder(mutation.folder, mutation.entityId);
		const current = statements.folder.get(ownerId, mutation.entityId);
		assertExpectedVersion(mutation.expectedVersion, current, 'folder');
		if (mutation.folder.parentId) {
			const parent = statements.folder.get(ownerId, mutation.folder.parentId);
			if (!parent || parent.deleted_at) throw new MutationValidationError('Parent folder does not exist.');
		}
		const timestamp = now();
		const version = (current?.server_version ?? 0) + 1;
		statements.putFolder.run(
			ownerId,
			mutation.entityId,
			mutation.folder.name.normalize('NFC').trim(),
			mutation.folder.parentId,
			version,
			current?.created_at ?? timestamp,
			timestamp
		);
		return { status: 'applied', entityType: 'folder', entityId: mutation.entityId, entityVersion: version };
	}

	function applyNote(mutation, ownerId) {
		validateNote(mutation.note, mutation.entityId);
		const current = statements.note.get(ownerId, mutation.entityId);
		assertExpectedVersion(mutation.expectedVersion, current, 'note');
		if (mutation.note.location !== SCRATCHPAD) {
			const folder = statements.folder.get(ownerId, mutation.note.location);
			if (!folder || folder.deleted_at) throw new MutationValidationError('Folder does not exist.');
		}
		const timestamp = now();
		const version = (current?.server_version ?? 0) + 1;
		statements.putNote.run(
			ownerId,
			mutation.entityId,
			mutation.note.title?.trim() || 'Untitled note',
			mutation.note.text,
			mutation.note.finalText ?? null,
			JSON.stringify(mutation.note.thoughts),
			mutation.note.location,
			version,
			current?.created_at ?? timestamp,
			timestamp
		);
		return { status: 'applied', entityType: 'note', entityId: mutation.entityId, entityVersion: version };
	}

	function applyNoteDeletion(mutation, ownerId) {
		const current = statements.note.get(ownerId, mutation.entityId);
		assertExpectedVersion(mutation.expectedVersion, current, 'note');
		if (!current || current.deleted_at) throw new MutationConflictError('Note is already deleted.');
		const timestamp = now();
		const version = current.server_version + 1;
		statements.deleteNote.run(SCRATCHPAD, version, timestamp, timestamp, ownerId, mutation.entityId);
		return { status: 'applied', entityType: 'note', entityId: mutation.entityId, entityVersion: version };
	}

	return {
		applyMutation,
		snapshot(ownerId = 'local-owner') {
			validateOwnerId(ownerId);
			return {
				schemaVersion: 3,
				folders: statements.activeFolders.all(ownerId).map(mapFolder),
				notes: statements.activeNotes.all(ownerId).map(mapNote)
			};
		},
		inspectTombstone(entityType, entityId, ownerId = 'local-owner') {
			validateOwnerId(ownerId);
			const row = entityType === 'note' ? statements.note.get(ownerId, entityId) : statements.folder.get(ownerId, entityId);
			if (!row?.deleted_at) return undefined;
			return {
				entityType,
				entityId,
				serverVersion: row.server_version,
				deletedAt: row.deleted_at
			};
		},
		health() {
			return {
				schemaVersion: Number(sqlite.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get().value),
				integrity: sqlite.prepare('PRAGMA quick_check').get().quick_check
			};
		},
		close() {
			sqlite.close();
		}
	};
}

function validateOwnerId(ownerId) {
	if (typeof ownerId !== 'string' || !ownerId || ownerId.length > 320) {
		throw new MutationValidationError('Owner identity is invalid.');
	}
}

function assertExpectedVersion(expectedVersion, current, entityType) {
	const currentVersion = current?.server_version ?? 0;
	if (expectedVersion !== currentVersion || current?.deleted_at) {
		throw new MutationConflictError(`${entityType} version does not match.`, {
			serverVersion: currentVersion,
			deleted: Boolean(current?.deleted_at)
		});
	}
}

function validateMutationEnvelope(mutation) {
	if (
		!mutation ||
		typeof mutation !== 'object' ||
		typeof mutation.mutationId !== 'string' ||
		!mutation.mutationId ||
		typeof mutation.entityId !== 'string' ||
		!mutation.entityId ||
		!Number.isSafeInteger(mutation.expectedVersion) ||
		mutation.expectedVersion < 0
	) {
		throw new MutationValidationError('Mutation envelope is invalid.');
	}
}

function validateFolder(folder, entityId) {
	const name = folder?.name?.normalize?.('NFC').trim();
	if (
		folder?.id !== entityId ||
		!name ||
		[...name].length > MAX_FOLDER_NAME_CHARACTERS ||
		/[\u0000-\u001f\u007f-\u009f/\\]/u.test(name) ||
		(folder.parentId !== null && typeof folder.parentId !== 'string')
	) {
		throw new MutationValidationError('Folder is invalid.');
	}
}

function validateNote(note, entityId) {
	if (
		note?.id !== entityId ||
		(note.title !== undefined && (typeof note.title !== 'string' || [...note.title.trim()].length > 120)) ||
		typeof note.text !== 'string' ||
		Buffer.byteLength(note.text, 'utf8') > MAX_NOTE_BYTES ||
		(note.finalText !== undefined && (typeof note.finalText !== 'string' || Buffer.byteLength(note.finalText, 'utf8') > MAX_NOTE_BYTES)) ||
		!Array.isArray(note.thoughts) ||
		typeof note.location !== 'string' ||
		!note.location
	) {
		throw new MutationValidationError('Note is invalid.');
	}
	let previousEnd = 0;
	const ids = new Set();
	for (const thought of note.thoughts) {
		if (
			typeof thought?.id !== 'string' ||
			!thought.id ||
			ids.has(thought.id) ||
			!Number.isInteger(thought.end) ||
			thought.end <= previousEnd ||
			thought.end > note.text.length
		) {
			throw new MutationValidationError('Thought boundaries are invalid.');
		}
		ids.add(thought.id);
		previousEnd = thought.end;
	}
	if (!note.thoughts.length || previousEnd !== note.text.length) {
		throw new MutationValidationError('Committed note content is invalid.');
	}
}

function hashMutation(mutation) {
	return createHash('sha256').update(stableJson(mutation)).digest('hex');
}

function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function mapFolder(row) {
	return {
		id: row.id,
		name: row.name,
		parentId: row.parent_id,
		serverVersion: row.server_version,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function mapNote(row) {
	return {
		id: row.id,
		title: row.title,
		text: row.text,
		finalText: row.final_text ?? undefined,
		thoughts: JSON.parse(row.thoughts_json),
		location: row.location,
		serverVersion: row.server_version,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}
