import { describe, expect, it, vi } from 'vitest';
import { HttpNotebookRemote, NotebookRemoteError } from './notebook-remote';

describe('HttpNotebookRemote', () => {
	it('loads the authorized same-origin notebook snapshot', async () => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify({ schemaVersion: 1, notes: [], folders: [] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const remote = new HttpNotebookRemote(request);

		expect(await remote.snapshot()).toEqual({ schemaVersion: 1, notes: [], folders: [] });
		expect(request).toHaveBeenCalledWith('/api/notebook/snapshot', {
			headers: { Accept: 'application/json' },
			signal: expect.any(AbortSignal)
		});
	});

	it('posts one mutation as bounded same-origin JSON', async () => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify({ status: 'applied', entityVersion: 3 }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const remote = new HttpNotebookRemote(request);
		const mutation = {
			mutationId: 'mutation-1',
			type: 'delete-note' as const,
			entityId: 'note-1',
			expectedVersion: 2
		};

		expect(await remote.applyMutation(mutation)).toEqual({ status: 'applied', entityVersion: 3 });
		expect(request).toHaveBeenCalledWith('/api/notebook/mutations', {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify(mutation),
			signal: expect.any(AbortSignal)
		});
	});

	it('reports sanitized status without including a server response body', async () => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify({ error: 'secret diagnostic' }), { status: 409 })
		);
		const remote = new HttpNotebookRemote(request);

		await expect(remote.snapshot()).rejects.toEqual(
			expect.objectContaining<Partial<NotebookRemoteError>>({ name: 'NotebookRemoteError', status: 409 })
		);
		await expect(remote.snapshot()).rejects.not.toThrow('secret diagnostic');
	});

	it('retains only structured conflict metadata from a rejected mutation', async () => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify({
				error: 'mutation_conflict',
				current: { serverVersion: 3, deleted: false },
				diagnostic: 'must not enter the error message'
			}), { status: 409 })
		);
		const remote = new HttpNotebookRemote(request);

		await expect(remote.applyMutation({
			mutationId: 'mutation-conflict',
			type: 'delete-note',
			entityId: 'note-1',
			expectedVersion: 2
		})).rejects.toMatchObject({
			status: 409,
			current: { serverVersion: 3, deleted: false },
			message: 'Notebook server request failed with status 409.'
		});
	});
});
