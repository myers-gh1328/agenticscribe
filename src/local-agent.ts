export interface AgentPreferences {
	automaticCleanup: boolean;
}

interface BrowserStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

interface AgentStatus {
	configured: boolean;
	available: boolean;
	model?: string;
}

interface CleanupResponse {
	cleanedThought?: string;
}

interface DistillationResponse {
	distilledNote?: string;
}

const PREFERENCES_KEY = 'agenticscribe.agent-preferences';
const LEGACY_SETTINGS_KEY = 'agenticscribe.local-agent';

export function saveAgentPreferences(
	preferences: AgentPreferences,
	storage: BrowserStorage = localStorage
) {
	storage.setItem(PREFERENCES_KEY, JSON.stringify({
		automaticCleanup: preferences.automaticCleanup === true
	}));
}

export function loadAgentPreferences(storage: BrowserStorage = localStorage): AgentPreferences {
	const current = parsePreferences(storage.getItem(PREFERENCES_KEY));
	if (current) return current;

	const legacy = parsePreferences(storage.getItem(LEGACY_SETTINGS_KEY));
	if (legacy) {
		storage.removeItem(LEGACY_SETTINGS_KEY);
		saveAgentPreferences(legacy, storage);
		return legacy;
	}
	return { automaticCleanup: true };
}

function parsePreferences(value: string | null): AgentPreferences | undefined {
	if (!value) return undefined;
	try {
		const parsed = JSON.parse(value) as { automaticCleanup?: unknown };
		if (typeof parsed.automaticCleanup !== 'boolean') return undefined;
		return { automaticCleanup: parsed.automaticCleanup };
	} catch {
		return undefined;
	}
}

export class LocalAgent {
	readonly #fetch: typeof fetch;

	constructor(request: typeof fetch = fetch) {
		this.#fetch = request.bind(globalThis);
	}

	async connect() {
		const response = await this.#fetch('/api/agent/status', {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(5_000)
		});
		if (!response.ok) throw new Error('The deployment-managed agent is unavailable.');
		const status = (await response.json()) as AgentStatus;
		if (!status.configured || !status.available || !status.model) {
			throw new Error('The deployment-managed agent is unavailable.');
		}
		return { model: status.model };
	}

	async cleanThought(thought: string) {
		const response = await this.#fetch('/api/agent/cleanup', {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify({ thought }),
			signal: AbortSignal.timeout(35_000)
		});
		if (!response.ok) throw new Error('The deployment-managed agent could not clean this thought.');
		const result = (await response.json()) as CleanupResponse;
		const cleaned = result.cleanedThought?.trim();
		if (!cleaned) throw new Error('The deployment-managed agent returned an empty thought.');
		return cleaned;
	}

	async distillNote(note: string) {
		const response = await this.#fetch('/api/agent/distill', {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify({ note }),
			signal: AbortSignal.timeout(35_000)
		});
		if (!response.ok) {
			if (response.status === 413) throw new Error('This note is too large to distill.');
			if (response.status === 503) throw new Error('The deployment-managed agent is busy or unavailable.');
			if (response.status === 504) throw new Error('The deployment-managed agent took too long to respond.');
			throw new Error('The deployment-managed agent could not distill this note.');
		}
		const result = (await response.json()) as DistillationResponse;
		const distilled = result.distilledNote?.trim();
		if (!distilled) throw new Error('The deployment-managed agent returned an empty distillation.');
		return distilled;
	}
}
