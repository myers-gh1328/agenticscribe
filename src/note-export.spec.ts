import { describe, expect, it } from 'vitest';
import { exportFilename, markdownToPlainText } from './note-export';

describe('note export', () => {
	it('creates safe filenames from note titles', () => {
		expect(exportFilename('# Quarterly / planning?', 'md')).toBe('Quarterly-planning.md');
		expect(exportFilename('', 'txt')).toBe('Untitled-note.txt');
	});

	it('turns portable Markdown into readable plain text', () => {
		expect(markdownToPlainText([
			'# Project update',
			'',
			'- **Decision:** ship the modal',
			'- [ ] Confirm [release notes](https://example.test)',
			'',
			'> Keep the original note.'
		].join('\n'))).toBe([
			'Project update',
			'',
			'Decision: ship the modal',
			'☐ Confirm release notes',
			'',
			'Keep the original note.'
		].join('\n'));
	});
});
