export interface MarkdownSourceFormat {
	lineEnding: 'lf' | 'crlf';
	byteOrderMark: boolean;
}

export interface MarkdownDocument extends MarkdownSourceFormat {
	text: string;
}

export function parseMarkdownSource(source: string): MarkdownDocument {
	const byteOrderMark = source.startsWith('\uFEFF');
	const content = byteOrderMark ? source.slice(1) : source;
	const lineEnding = content.includes('\r\n') ? 'crlf' : 'lf';
	return {
		text: content.replaceAll('\r\n', '\n').replaceAll('\r', '\n'),
		lineEnding,
		byteOrderMark
	};
}

export function serializeMarkdownSource(text: string, format: MarkdownSourceFormat) {
	const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
	const content = format.lineEnding === 'crlf' ? normalized.replaceAll('\n', '\r\n') : normalized;
	return `${format.byteOrderMark ? '\uFEFF' : ''}${content}`;
}
