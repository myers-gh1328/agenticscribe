import { randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

export async function backupNotebookDatabase({ sourcePath, destinationPath }) {
	await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
	const partialPath = `${destinationPath}.partial-${randomUUID()}`;
	const source = new DatabaseSync(sourcePath, { readOnly: true });
	try {
		await backup(source, partialPath);
	} finally {
		source.close();
	}

	try {
		await chmod(partialPath, 0o600);
		const verification = verifyNotebookDatabase(partialPath);
		await rename(partialPath, destinationPath);
		return verification;
	} catch (error) {
		await rm(partialPath, { force: true });
		throw error;
	}
}

export function verifyNotebookDatabase(path) {
	const database = new DatabaseSync(path, { readOnly: true });
	try {
		const integrity = database.prepare('PRAGMA integrity_check').get().integrity_check;
		if (integrity !== 'ok') throw new Error('Notebook snapshot failed its integrity check.');
		const schemaVersion = Number(
			database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get().value
		);
		return { integrity, schemaVersion };
	} finally {
		database.close();
	}
}
