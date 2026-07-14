import { describe, expect, it, vi } from 'vitest';
import { initializeNotebookIdentity, notebookDatabaseName, resolveNotebookDatabaseName } from './auth-bootstrap';

describe('authentication bootstrap', () => {
	it('partitions browser notebook state by the verified Entra object ID', async () => {
		const ownerOne = await resolveNotebookDatabaseName(sessionFetch('OWNER-ONE'));
		const ownerTwo = await resolveNotebookDatabaseName(sessionFetch('owner-two'));

		expect(ownerOne).toBe('agenticscribe-owner-one');
		expect(ownerTwo).toBe('agenticscribe-owner-two');
		expect(ownerOne).not.toBe(ownerTwo);
	});

	it('keeps the deployment-local database when no authenticated identity is supplied', async () => {
		const fetcher = vi.fn(async () => new Response('Not found', { status: 404 }));
		expect(await resolveNotebookDatabaseName(fetcher)).toBe('agenticscribe');
	});

	it('reuses only the last verified identity partition when startup is offline', async () => {
		const values = new Map<string, string>();
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key)
		};
		await initializeNotebookIdentity(sessionFetch('owner-one'), storage);
		await initializeNotebookIdentity(vi.fn(async () => { throw new TypeError('offline'); }), storage);

		expect(notebookDatabaseName()).toBe('agenticscribe-owner-one');
	});
});

function sessionFetch(oid: string) {
	return vi.fn(async () => Response.json({ authenticated: true, user: { oid } }));
}
