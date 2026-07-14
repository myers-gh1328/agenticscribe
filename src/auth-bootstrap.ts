let databaseName = 'agenticscribe';
const identityStorageKey = 'agenticscribe-notebook-database';

export async function initializeNotebookIdentity(
	fetcher: typeof fetch = fetch,
	storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage
): Promise<void> {
	try {
		databaseName = await resolveNotebookDatabaseName(fetcher);
		if (databaseName === 'agenticscribe') storage.removeItem(identityStorageKey);
		else storage.setItem(identityStorageKey, databaseName);
	} catch (error) {
		if (error instanceof InvalidNotebookIdentityError) throw error;
		databaseName = storage.getItem(identityStorageKey) ?? 'agenticscribe';
	}
}

export function notebookDatabaseName(): string {
	return databaseName;
}

export async function resolveNotebookDatabaseName(fetcher: typeof fetch = fetch): Promise<string> {
	const response = await fetcher('/api/auth/session', {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(1_000)
	});
	if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
		return 'agenticscribe';
	}
	const session = await response.json();
	if (!session?.authenticated) return 'agenticscribe';
	const oid = session.user?.oid;
	if (typeof oid !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(oid)) {
		throw new InvalidNotebookIdentityError();
	}
	return `agenticscribe-${oid.toLowerCase()}`;
}

class InvalidNotebookIdentityError extends Error {
	constructor() {
		super('Authenticated notebook identity is invalid.');
	}
}
