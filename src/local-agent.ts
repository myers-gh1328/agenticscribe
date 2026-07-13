export interface AgentSettings {
	baseUrl: string;
	model: string;
	automaticCleanup: boolean;
}

interface BrowserStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

interface ModelsResponse {
	data?: Array<{ id?: string }>;
}

interface ChatResponse {
	choices?: Array<{ message?: { content?: string } }>;
}

const SETTINGS_KEY = 'agenticscribe.local-agent';

function normalizeSettings(settings: AgentSettings): AgentSettings {
	const url = new URL(settings.baseUrl.trim());
	if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The agent URL must use HTTP or HTTPS.');
	return {
		baseUrl: url.toString().replace(/\/$/, ''),
		model: settings.model.trim(),
		automaticCleanup: settings.automaticCleanup
	};
}

export function saveAgentSettings(settings: AgentSettings, storage: BrowserStorage = localStorage) {
	storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
}

export function loadAgentSettings(storage: BrowserStorage = localStorage): AgentSettings | undefined {
	const saved = storage.getItem(SETTINGS_KEY);
	if (!saved) return undefined;
	try {
		return normalizeSettings(JSON.parse(saved) as AgentSettings);
	} catch {
		return undefined;
	}
}

export class LocalAgent {
	readonly #settings: AgentSettings;
	readonly #fetch: typeof fetch;

	constructor(settings: AgentSettings, request: typeof fetch = fetch) {
		this.#settings = normalizeSettings(settings);
		this.#fetch = request.bind(globalThis);
	}

	async connect() {
		const response = await this.#fetch(`${this.#settings.baseUrl}/models`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(5_000)
		});
		if (!response.ok) throw new Error('The local agent did not accept the connection.');
		const models = (await response.json()) as ModelsResponse;
		if (!models.data?.some((model) => model.id === this.#settings.model)) {
			throw new Error('The configured model is not available on this agent.');
		}
	}

	async cleanThought(thought: string) {
		const response = await this.#fetch(`${this.#settings.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: this.#settings.model,
				temperature: 0,
				messages: [
					{
						role: 'system',
						content:
							'Correct only spelling, grammar, capitalization, and punctuation in the submitted thought. Preserve its meaning, wording, tone, and line breaks. Do not add, remove, summarize, explain, or reorganize anything. Return only the corrected thought without quotation marks.'
					},
					{ role: 'user', content: thought }
				]
			}),
			signal: AbortSignal.timeout(30_000)
		});
		if (!response.ok) throw new Error('The local agent could not clean this thought.');
		const result = (await response.json()) as ChatResponse;
		const cleaned = result.choices?.[0]?.message?.content?.trim();
		if (!cleaned) throw new Error('The local agent returned an empty thought.');
		return cleaned;
	}
}
