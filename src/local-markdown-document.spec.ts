import { describe, expect, it, vi } from 'vitest';
import {
	LocalMarkdownConflictError,
	LocalMarkdownDocument,
	type LocalMarkdownFile,
	type LocalMarkdownRecovery
} from './local-markdown-document';

function createFile(source = '# Existing\n') {
	let current = source;
	const writes: string[] = [];
	const file: LocalMarkdownFile = {
		name: 'notes.md',
		read: vi.fn(async () => current),
		write: vi.fn(async (next) => {
			writes.push(next);
			current = next;
		})
	};
	return { file, writes, changeExternally: (next: string) => { current = next; } };
}

function createRecovery() {
	const saved: string[] = [];
	let cleared = 0;
	const recovery: LocalMarkdownRecovery = {
		save: vi.fn(async (text) => { saved.push(text); }),
		clear: vi.fn(async () => { cleared += 1; })
	};
	return { recovery, saved, cleared: () => cleared };
}

describe('LocalMarkdownDocument', () => {
	it('writes only the corrected final document after cleanup succeeds', async () => {
		const { file, writes } = createFile();
		const { recovery, saved, cleared } = createRecovery();
		const document = await LocalMarkdownDocument.open(file, recovery);

		const result = await document.commit('# Existing\nthis need correction\n', async (thought) => {
			expect(thought).toBe('this need correction');
			expect(writes).toEqual([]);
			return 'This needs correction.';
		});

		expect(result).toEqual({ text: '# Existing\nThis needs correction.\n', cleanup: 'applied' });
		expect(saved).toEqual(['# Existing\nthis need correction\n']);
		expect(writes).toEqual(['# Existing\nThis needs correction.\n']);
		expect(cleared()).toBe(1);
	});

	it('writes the raw final document once only after cleanup fails', async () => {
		const { file, writes } = createFile();
		const { recovery } = createRecovery();
		const document = await LocalMarkdownDocument.open(file, recovery);

		const result = await document.commit('# Existing\nkeep raw\n', async () => {
			expect(writes).toEqual([]);
			throw new Error('agent unavailable');
		});

		expect(result.cleanup).toBe('failed');
		expect(writes).toEqual(['# Existing\nkeep raw\n']);
	});

	it('does not send a rewritten Markdown document for cleanup', async () => {
		const { file, writes } = createFile('# Heading\n\n```ts\nconst value = 1;\n```\n');
		const { recovery } = createRecovery();
		const document = await LocalMarkdownDocument.open(file, recovery);
		const cleanup = vi.fn(async () => 'should not be used');
		const rewritten = '# Renamed\n\n```ts\nconst value = 2;\n```\n';

		const result = await document.commit(rewritten, cleanup);

		expect(result.cleanup).toBe('skipped');
		expect(cleanup).not.toHaveBeenCalled();
		expect(writes).toEqual([rewritten]);
	});

	it('retains recovery and refuses to overwrite an externally changed file', async () => {
		const { file, writes, changeExternally } = createFile();
		const { recovery, cleared } = createRecovery();
		const document = await LocalMarkdownDocument.open(file, recovery);
		changeExternally('# Changed elsewhere\n');

		await expect(document.commit('# Existing\nLocal change\n')).rejects.toBeInstanceOf(
			LocalMarkdownConflictError
		);

		expect(writes).toEqual([]);
		expect(cleared()).toBe(0);
	});

	it('serializes writes in commit order', async () => {
		const { file, writes } = createFile();
		const { recovery } = createRecovery();
		const document = await LocalMarkdownDocument.open(file, recovery);
		let release!: () => void;
		const paused = new Promise<void>((resolve) => { release = resolve; });

		const first = document.commit('# Existing\nFirst\n', async () => {
			await paused;
			return 'First.';
		});
		const second = document.commit('# Existing\nFirst.\nSecond\n');
		release();
		await Promise.all([first, second]);

		expect(writes).toEqual([
			'# Existing\nFirst.\n',
			'# Existing\nFirst.\nSecond\n'
		]);
	});
});
