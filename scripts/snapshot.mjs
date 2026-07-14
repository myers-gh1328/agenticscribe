import { resolve } from 'node:path';
import { backupNotebookDatabase } from './lib/notebook-backup.mjs';

const [sourcePath, destinationPath] = process.argv.slice(2);
if (!sourcePath || !destinationPath) {
	console.error('Usage: npm run snapshot -- <database-path> <snapshot-path>');
	process.exit(2);
}

const result = await backupNotebookDatabase({
	sourcePath: resolve(sourcePath),
	destinationPath: resolve(destinationPath)
});
console.log(JSON.stringify({ event: 'agenticscribe_snapshot_complete', ...result }));
