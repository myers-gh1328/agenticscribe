import { requireElement } from './dom';
import { LocalAgent, loadAgentSettings, saveAgentSettings } from './local-agent';
import './agent-setup.css';

interface AgentSetupOptions {
	onOpen(): void;
	onClose(): void;
}

export class AgentSetup {
	readonly #form = requireElement<HTMLFormElement>('#agent-setup-form');
	readonly #status = requireElement<HTMLElement>('#agent-status');
	readonly #baseUrl = requireElement<HTMLInputElement>('[name="baseUrl"]', this.#form);
	readonly #model = requireElement<HTMLSelectElement>('[name="model"]', this.#form);
	readonly #automaticCleanup = requireElement<HTMLInputElement>(
		'[name="automaticCleanup"]',
		this.#form
	);
	readonly #connectButton = requireElement<HTMLButtonElement>('.connect-agent', this.#form);
	#agent: LocalAgent | undefined;

	constructor(options: AgentSetupOptions) {
		const saved = loadAgentSettings();
		if (saved) {
			this.#baseUrl.value = saved.baseUrl;
			this.#model.value = saved.model;
			this.#automaticCleanup.checked = saved.automaticCleanup;
			this.#agent = new LocalAgent(saved);
			this.#status.textContent = 'Configured';
		}

		const closeButton = requireElement<HTMLButtonElement>('#close-agent-setup');
		requireElement<HTMLButtonElement>('#open-agent-setup').addEventListener('click', () => {
			options.onOpen();
			closeButton.focus();
		});
		closeButton.addEventListener('click', options.onClose);
		this.#form.addEventListener('submit', (event) => void this.#connect(event));
	}

	get agent() {
		return this.#agent;
	}

	get automaticCleanupEnabled() {
		return this.#automaticCleanup.checked;
	}

	async #connect(event: SubmitEvent) {
		event.preventDefault();
		this.#connectButton.disabled = true;
		this.#setStatus('Connecting…');
		const settings = {
			baseUrl: this.#baseUrl.value,
			model: this.#model.value,
			automaticCleanup: this.#automaticCleanup.checked
		};

		try {
			const candidate = new LocalAgent(settings);
			await candidate.connect();
			saveAgentSettings(settings);
			this.#agent = candidate;
			this.#setStatus('Connected', 'connected');
		} catch {
			this.#agent = undefined;
			this.#setStatus('Connection failed', 'failed');
		} finally {
			this.#connectButton.disabled = false;
		}
	}

	#setStatus(text: string, state?: 'connected' | 'failed') {
		this.#status.className = `status-pill${state ? ` ${state}` : ''}`;
		this.#status.textContent = text;
	}
}
