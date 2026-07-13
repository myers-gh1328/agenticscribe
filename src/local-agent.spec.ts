import { describe, expect, it, vi } from 'vitest';
import { LocalAgent, loadAgentSettings, saveAgentSettings, type AgentSettings } from './local-agent';

const settings: AgentSettings = {
	baseUrl: 'http://192.168.4.43:8080/v1',
	model: 'mlx-community/gemma-4-e4b-it-8bit',
	automaticCleanup: true
};

function memoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value)
	};
}

describe('local agent settings', () => {
	it('saves validated connection settings in browser storage', () => {
		const storage = memoryStorage();

		saveAgentSettings({ ...settings, baseUrl: `${settings.baseUrl}/` }, storage);

		expect(loadAgentSettings(storage)).toEqual(settings);
	});
});

describe('LocalAgent', () => {
	it('connects only when the configured model is available', async () => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify({ data: [{ id: settings.model }] }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

		await expect(new LocalAgent(settings, request).connect()).resolves.toBeUndefined();
		expect(request).toHaveBeenCalledWith(`${settings.baseUrl}/models`, {
			headers: { Accept: 'application/json' },
			signal: expect.any(AbortSignal)
		});
	});

	it('sends only the submitted thought for strict grammar cleanup', async () => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(
				JSON.stringify({ choices: [{ message: { content: 'This thought has poor grammar.' } }] }),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);

		await expect(new LocalAgent(settings, request).cleanThought('this thought have bad grammer.')).resolves.toBe(
			'This thought has poor grammar.'
		);
		const [, options] = request.mock.calls[0]!;
		const body = JSON.parse(String(options?.body));
		expect(body).toMatchObject({ model: settings.model, temperature: 0 });
		expect(body.messages).toEqual([
			expect.objectContaining({ role: 'system' }),
			{ role: 'user', content: 'this thought have bad grammer.' }
		]);
	});
});
