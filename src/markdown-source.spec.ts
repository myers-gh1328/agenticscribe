import { describe, expect, it } from 'vitest';
import { parseMarkdownSource, serializeMarkdownSource } from './markdown-source';

const markdown = `---
title: Café notes
---

# Heading

- [x] nested **item** with [a link](https://example.test)
  - child

> quoted \`code\`

\`\`\`ts
const untouched = '# not a heading';
\`\`\`
`;

describe('Markdown source format', () => {
	it('preserves Markdown source using LF without a byte-order mark', () => {
		const document = parseMarkdownSource(markdown);

		expect(document).toEqual({ text: markdown, lineEnding: 'lf', byteOrderMark: false });
		expect(serializeMarkdownSource(document.text, document)).toBe(markdown);
	});

	it('restores CRLF and a UTF-8 byte-order mark after browser editing', () => {
		const source = `\uFEFF${markdown.replaceAll('\n', '\r\n')}`;
		const document = parseMarkdownSource(source);

		expect(document).toEqual({ text: markdown, lineEnding: 'crlf', byteOrderMark: true });
		expect(serializeMarkdownSource(document.text, document)).toBe(source);
	});

	it('preserves the absence of a trailing newline', () => {
		const source = '# Final heading';
		const document = parseMarkdownSource(source);

		expect(serializeMarkdownSource(document.text, document)).toBe(source);
	});
});
