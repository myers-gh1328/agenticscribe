export type NoteExportFormat = 'md' | 'txt';

export function exportFilename(title: string, format: NoteExportFormat) {
	const safe = title
		.replace(/^#{1,6}\s+/, '')
		.normalize('NFKC')
		.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ')
		.trim()
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.slice(0, 80)
		.replace(/[. -]+$/g, '');
	return `${safe || 'Untitled-note'}.${format}`;
}

export function markdownToPlainText(markdown: string) {
	return markdown
		.replace(/^```[^\n]*\n?/gm, '')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/^[ \t]*>[ \t]?/gm, '')
		.replace(/^[ \t]*[-*+][ \t]+\[ \][ \t]+/gm, '☐ ')
		.replace(/^[ \t]*[-*+][ \t]+\[[xX]\][ \t]+/gm, '☒ ')
		.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/(\*\*|__)(.*?)\1/g, '$2')
		.replace(/(\*|_)(.*?)\1/g, '$2')
		.replace(/~~(.*?)~~/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.trimEnd();
}

export function downloadNote(markdown: string, title: string, format: NoteExportFormat) {
	const content = format === 'md' ? markdown : markdownToPlainText(markdown);
	const blob = new Blob([content], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = exportFilename(title, format);
	link.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
