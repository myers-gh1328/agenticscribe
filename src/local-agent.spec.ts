import { describe, expect, it, vi } from 'vitest';
import { LocalAgent, loadAgentPreferences, saveAgentPreferences } from './local-agent';

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key)
	};
}

describe('local agent preferences', () => {
	it('stores only the automatic-cleanup preference in the browser', () => {
		const storage = memoryStorage();

		saveAgentPreferences({ automaticCleanup: false }, storage);

		expect(loadAgentPreferences(storage)).toEqual({ automaticCleanup: false });
		expect(storage.getItem('agenticscribe.agent-preferences')).toBe(
			JSON.stringify({ automaticCleanup: false })
		);
	});

	it('migrates only the preference from legacy browser-owned connection settings', () => {
		const storage = memoryStorage({
			'agenticscribe.local-agent': JSON.stringify({
				baseUrl: 'http://stale-private-host.invalid/v1',
				model: 'stale-model',
				automaticCleanup: false
			})
		});

		expect(loadAgentPreferences(storage)).toEqual({ automaticCleanup: false });
		expect(storage.getItem('agenticscribe.local-agent')).toBeNull();
	});
});

describe('LocalAgent', () => {
	it('checks deployment-managed status through the same-origin app API', async () => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({ configured: true, available: true, model: 'deployed-model' })
		);

		await expect(new LocalAgent(request).connect()).resolves.toEqual({ model: 'deployed-model' });
		expect(request).toHaveBeenCalledWith('/api/agent/status', {
			headers: { Accept: 'application/json' },
			signal: expect.any(AbortSignal)
		});
	});

	it('sends only the submitted thought to the same-origin cleanup API', async () => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({ cleanedThought: 'This thought has poor grammar.' })
		);

		await expect(new LocalAgent(request).cleanThought('this thought have bad grammer.')).resolves.toBe(
			'This thought has poor grammar.'
		);
		expect(request).toHaveBeenCalledWith('/api/agent/cleanup', {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify({ thought: 'this thought have bad grammer.' }),
			signal: expect.any(AbortSignal)
		});
	});

	it('sends the current note to the bounded same-origin distillation API', async () => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({ distilledNote: '# Summary\n\nA concise result.' })
		);

		await expect(new LocalAgent(request).distillNote('# Raw note')).resolves.toBe(
			'# Summary\n\nA concise result.'
		);
		expect(request).toHaveBeenCalledWith('/api/agent/distill', {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify({ note: '# Raw note' }),
			signal: expect.any(AbortSignal)
		});
	});

	it.each([
		[413, 'This note is too large to distill.'],
		[503, 'The deployment-managed agent is busy or unavailable.'],
		[504, 'The deployment-managed agent took too long to respond.'],
		[502, 'The deployment-managed agent could not distill this note.']
	])('maps distillation status %i to a useful error', async (status, message) => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status }));

		await expect(new LocalAgent(request).distillNote('A note')).rejects.toThrow(message);
	});

	it('rejects an empty distillation', async () => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ distilledNote: '  ' }));

		await expect(new LocalAgent(request).distillNote('A note')).rejects.toThrow(
			'The deployment-managed agent returned an empty distillation.'
		);
	});
});
