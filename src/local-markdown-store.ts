import Dexie, { type EntityTable } from 'dexie';

export interface LocalMarkdownBinding {
	id: string;
	name: string;
	handle: FileSystemFileHandle;
	text: string;
	recoveryText: string | null;
}

interface BindingInput {
	id: string;
	name: string;
	handle: FileSystemFileHandle;
	text: string;
}

class LocalMarkdownDatabase extends Dexie {
	bindings!: EntityTable<LocalMarkdownBinding, 'id'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores({ bindings: '&id, name' });
	}
}

export class LocalMarkdownStore {
	readonly #database: LocalMarkdownDatabase;

	constructor(databaseName = 'agenticscribe-local-markdown') {
		this.#database = new LocalMarkdownDatabase(databaseName);
	}

	async bind(input: BindingInput) {
		await this.#database.bindings.put({ ...input, recoveryText: null });
	}

	async list() {
		return this.#database.bindings.toArray();
	}

	async get(id: string) {
		return this.#database.bindings.get(id);
	}

	async saveRecovery(id: string, text: string) {
		await this.#database.bindings.update(id, { recoveryText: text });
	}

	async clearRecovery(id: string, text: string) {
		await this.#database.bindings.update(id, { text, recoveryText: null });
	}

	async remove(id: string) {
		await this.#database.bindings.delete(id);
	}

	async deleteDatabase() {
		this.#database.close();
		await Dexie.delete(this.#database.name);
	}
}
