import type { NotebookMutation, NotebookRemote, NotebookSnapshot } from './notebook-store';

export class NotebookRemoteError extends Error {
	readonly status: number;
	readonly current: unknown;

	constructor(status: number, current?: unknown) {
		super(`Notebook server request failed with status ${status}.`);
		this.name = 'NotebookRemoteError';
		this.status = status;
		this.current = current;
	}
}

export class HttpNotebookRemote implements NotebookRemote {
	readonly #request: typeof fetch;

	constructor(request: typeof fetch = fetch) {
		this.#request = request.bind(globalThis);
	}

	async snapshot(): Promise<NotebookSnapshot> {
		const response = await this.#request('/api/notebook/snapshot', {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(10_000)
		});
		if (!response.ok) throw await notebookRemoteError(response);
		return (await response.json()) as NotebookSnapshot;
	}

	async applyMutation(mutation: NotebookMutation) {
		const response = await this.#request('/api/notebook/mutations', {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify(mutation),
			signal: AbortSignal.timeout(15_000)
		});
		if (!response.ok) throw await notebookRemoteError(response);
		return (await response.json()) as { status: string; entityVersion: number };
	}
}

async function notebookRemoteError(response: Response) {
	try {
		const body = await response.json() as { current?: unknown };
		return new NotebookRemoteError(response.status, body.current);
	} catch {
		return new NotebookRemoteError(response.status);
	}
}
