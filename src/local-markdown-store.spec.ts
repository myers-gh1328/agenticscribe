import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalMarkdownStore } from './local-markdown-store';

const stores: LocalMarkdownStore[] = [];

afterEach(async () => {
	await Promise.all(stores.splice(0).map((store) => store.deleteDatabase()));
});

describe('LocalMarkdownStore', () => {
	it('keeps a device-local binding and recoverable text outside the notebook store', async () => {
		const store = new LocalMarkdownStore(`local-markdown-${crypto.randomUUID()}`);
		stores.push(store);
		const handle = { kind: 'file', name: 'private.md' } as FileSystemFileHandle;

		await store.bind({ id: 'local-1', name: 'private.md', handle, text: '# Private\n' });
		await store.saveRecovery('local-1', '# Private\nunfinished');

		expect(await store.list()).toEqual([
			{
				id: 'local-1',
				name: 'private.md',
				handle,
				text: '# Private\n',
				recoveryText: '# Private\nunfinished'
			}
		]);

		await store.clearRecovery('local-1', '# Private\nfinished\n');
		expect(await store.get('local-1')).toMatchObject({
			text: '# Private\nfinished\n',
			recoveryText: null
		});
	});

	it('removes only the binding record', async () => {
		const store = new LocalMarkdownStore(`local-markdown-${crypto.randomUUID()}`);
		stores.push(store);
		await store.bind({
			id: 'local-1',
			name: 'keep-on-disk.md',
			handle: { kind: 'file', name: 'keep-on-disk.md' } as FileSystemFileHandle,
			text: 'Keep me'
		});

		await store.remove('local-1');

		expect(await store.list()).toEqual([]);
	});
});
