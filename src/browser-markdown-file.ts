import type { LocalMarkdownFile } from './local-markdown-document';

type WritableFileHandle = FileSystemFileHandle & {
	queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
	requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
};

export class LocalFilePermissionError extends Error {
	constructor() {
		super('Permission to use this local Markdown file is needed.');
		this.name = 'LocalFilePermissionError';
	}
}

export class BrowserMarkdownFile implements LocalMarkdownFile {
	readonly #handle: WritableFileHandle;

	constructor(handle: FileSystemFileHandle) {
		this.#handle = handle as WritableFileHandle;
	}

	get name() {
		return this.#handle.name;
	}

	async requestAccess() {
		if ((await this.#handle.queryPermission({ mode: 'readwrite' })) === 'granted') return;
		if ((await this.#handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
			throw new LocalFilePermissionError();
		}
	}

	async read() {
		await this.#requirePermission('read');
		return (await this.#handle.getFile()).text();
	}

	async write(source: string) {
		await this.#requirePermission('readwrite');
		const writable = await this.#handle.createWritable();
		await writable.write(source);
		await writable.close();
	}

	async #requirePermission(mode: 'read' | 'readwrite') {
		if ((await this.#handle.queryPermission({ mode })) !== 'granted') {
			throw new LocalFilePermissionError();
		}
	}
}

export function supportsLocalMarkdownFiles(target: Window = window) {
	return 'showOpenFilePicker' in target;
}

export async function pickLocalMarkdownHandle(target: Window = window) {
	const picker = (target as Window & {
		showOpenFilePicker(options: unknown): Promise<FileSystemFileHandle[]>;
	}).showOpenFilePicker;
	const [handle] = await picker({
		multiple: false,
		excludeAcceptAllOption: true,
		types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }]
	});
	if (!handle) throw new Error('No Markdown file was selected.');
	return handle;
}
