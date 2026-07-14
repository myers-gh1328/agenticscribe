import {
	parseMarkdownSource,
	serializeMarkdownSource,
	type MarkdownSourceFormat
} from './markdown-source';

export interface LocalMarkdownFile {
	name: string;
	read(): Promise<string>;
	write(source: string): Promise<void>;
}

export interface LocalMarkdownRecovery {
	save(text: string): Promise<void>;
	clear(text: string): Promise<void>;
}

export interface LocalMarkdownCommit {
	text: string;
	cleanup: 'applied' | 'failed' | 'skipped';
}

export class LocalMarkdownConflictError extends Error {
	constructor() {
		super('The Markdown file changed outside AgenticScribe. Your local edit was preserved.');
		this.name = 'LocalMarkdownConflictError';
	}
}

export class LocalMarkdownDocument {
	readonly name: string;
	readonly #file: LocalMarkdownFile;
	readonly #recovery: LocalMarkdownRecovery;
	readonly #format: MarkdownSourceFormat;
	#source: string;
	#text: string;
	#queue = Promise.resolve<LocalMarkdownCommit | undefined>(undefined);

	private constructor(
		file: LocalMarkdownFile,
		recovery: LocalMarkdownRecovery,
		source: string,
		text: string,
		format: MarkdownSourceFormat
	) {
		this.name = file.name;
		this.#file = file;
		this.#recovery = recovery;
		this.#source = source;
		this.#text = text;
		this.#format = format;
	}

	static async open(file: LocalMarkdownFile, recovery: LocalMarkdownRecovery) {
		const source = await file.read();
		const document = parseMarkdownSource(source);
		return new LocalMarkdownDocument(file, recovery, source, document.text, document);
	}

	get text() {
		return this.#text;
	}

	commit(submittedText: string, cleanThought?: (thought: string) => Promise<string>) {
		const operation = this.#queue.then(() => this.#commit(submittedText, cleanThought));
		this.#queue = operation.catch(() => undefined);
		return operation;
	}

	async #commit(submittedText: string, cleanThought?: (thought: string) => Promise<string>) {
		await this.#recovery.save(submittedText);
		let finalText = submittedText;
		let cleanup: LocalMarkdownCommit['cleanup'] = 'skipped';
		const appended = submittedText.startsWith(this.#text);
		const rawSegment = appended ? submittedText.slice(this.#text.length) : '';
		const terminator = rawSegment.endsWith('\n') ? '\n' : '';
		const rawThought = terminator ? rawSegment.slice(0, -1) : rawSegment;

		if (cleanThought && appended && rawThought.trim()) {
			try {
				const cleaned = await cleanThought(rawThought);
				finalText = `${this.#text}${cleaned}${terminator}`;
				cleanup = 'applied';
			} catch {
				cleanup = 'failed';
			}
		}

		if ((await this.#file.read()) !== this.#source) throw new LocalMarkdownConflictError();
		const source = serializeMarkdownSource(finalText, this.#format);
		await this.#file.write(source);
		this.#source = source;
		this.#text = finalText;
		await this.#recovery.clear(finalText);
		return { text: finalText, cleanup };
	}
}
