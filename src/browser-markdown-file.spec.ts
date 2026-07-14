import { describe, expect, it, vi } from 'vitest';
import { BrowserMarkdownFile, LocalFilePermissionError } from './browser-markdown-file';

describe('BrowserMarkdownFile', () => {
	it('reads and closes one writable stream for a final write', async () => {
		const write = vi.fn(async () => undefined);
		const close = vi.fn(async () => undefined);
		const handle = {
			name: 'notes.md',
			queryPermission: vi.fn(async () => 'granted'),
			getFile: vi.fn(async () => ({ text: async () => '# Notes\n' })),
			createWritable: vi.fn(async () => ({ write, close }))
		} as unknown as FileSystemFileHandle;
		const file = new BrowserMarkdownFile(handle);

		expect(await file.read()).toBe('# Notes\n');
		await file.write('# Notes\nFinal\n');

		expect(write).toHaveBeenCalledOnce();
		expect(write).toHaveBeenCalledWith('# Notes\nFinal\n');
		expect(close).toHaveBeenCalledOnce();
	});

	it('refuses access when browser permission is unavailable', async () => {
		const handle = {
			name: 'notes.md',
			queryPermission: vi.fn(async () => 'prompt')
		} as unknown as FileSystemFileHandle;
		const file = new BrowserMarkdownFile(handle);

		await expect(file.read()).rejects.toBeInstanceOf(LocalFilePermissionError);
	});
});
