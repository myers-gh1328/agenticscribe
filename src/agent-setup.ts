import { requireElement } from './dom';
import { LocalAgent, loadAgentPreferences, saveAgentPreferences } from './local-agent';
import './agent-setup.css';

interface AgentSetupOptions {
	onOpen(): void;
	onClose(): void;
}

export class AgentSetup {
	readonly #form = requireElement<HTMLFormElement>('#agent-setup-form');
	readonly #status = requireElement<HTMLElement>('#agent-status');
	readonly #model = requireElement<HTMLElement>('#agent-model', this.#form);
	readonly #automaticCleanup = requireElement<HTMLInputElement>(
		'[name="automaticCleanup"]',
		this.#form
	);
	readonly #connectButton = requireElement<HTMLButtonElement>('.connect-agent', this.#form);
	readonly #agent = new LocalAgent();
	#connected = false;

	constructor(options: AgentSetupOptions) {
		this.#automaticCleanup.checked = loadAgentPreferences().automaticCleanup;

		const closeButton = requireElement<HTMLButtonElement>('#close-agent-setup');
		requireElement<HTMLButtonElement>('#open-agent-setup').addEventListener('click', () => {
			options.onOpen();
			closeButton.focus();
		});
		closeButton.addEventListener('click', options.onClose);
		this.#form.addEventListener('submit', (event) => void this.#connect(event));
		this.#automaticCleanup.addEventListener('change', () => {
			saveAgentPreferences({ automaticCleanup: this.#automaticCleanup.checked });
		});
		void this.#refreshConnection(false);
	}

	get agent() {
		return this.#connected ? this.#agent : undefined;
	}

	get automaticCleanupEnabled() {
		return this.#automaticCleanup.checked;
	}

	async #connect(event: SubmitEvent) {
		event.preventDefault();
		this.#connectButton.disabled = true;
		this.#setStatus('Connecting…');
		await this.#refreshConnection(true);
		this.#connectButton.disabled = false;
	}

	async #refreshConnection(showFailure: boolean) {
		try {
			const status = await this.#agent.connect();
			this.#model.textContent = status.model;
			this.#connected = true;
			this.#setStatus('Connected', 'connected');
		} catch {
			if (showFailure) this.#setStatus('Connection failed', 'failed');
		}
	}

	#setStatus(text: string, state?: 'connected' | 'failed') {
		this.#status.className = `status-pill${state ? ` ${state}` : ''}`;
		this.#status.textContent = text;
	}
}
