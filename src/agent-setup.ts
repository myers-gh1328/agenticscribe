import { requireElement } from './dom';
import { LocalAgent, loadAgentPreferences, saveAgentPreferences } from './local-agent';
import './agent-setup.css';

interface AgentSetupOptions {
	onOpen(): void;
	onClose(): void;
	onStatus?(status: { connected: boolean; voice: boolean }): void;
}

export class AgentSetup {
	readonly #onStatus: NonNullable<AgentSetupOptions['onStatus']>;
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
	#connectionRefresh: Promise<void> | undefined;
	#showConnectionFailure = false;

	constructor(options: AgentSetupOptions) {
		this.#onStatus = options.onStatus ?? (() => undefined);
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

	async agentForCleanup() {
		if (!this.#connected) await this.#refreshConnection(false);
		return this.agent;
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
		this.#showConnectionFailure ||= showFailure;
		if (this.#connectionRefresh) return this.#connectionRefresh;
		const refresh = this.#runConnectionRefresh();
		this.#connectionRefresh = refresh;
		try {
			await refresh;
		} finally {
			if (this.#connectionRefresh === refresh) {
				this.#connectionRefresh = undefined;
				this.#showConnectionFailure = false;
			}
		}
	}

	async #runConnectionRefresh() {
		try {
			const status = await this.#agent.connect();
			this.#model.textContent = status.model;
			this.#connected = true;
			this.#onStatus({ connected: true, voice: status.voice });
			this.#setStatus('Connected', 'connected');
		} catch {
			this.#connected = false;
			this.#model.textContent = 'Unavailable';
			this.#onStatus({ connected: false, voice: false });
			this.#setStatus(this.#showConnectionFailure ? 'Connection failed' : 'Not connected', this.#showConnectionFailure ? 'failed' : undefined);
		}
	}

	#setStatus(text: string, state?: 'connected' | 'failed') {
		this.#status.className = `status-pill${state ? ` ${state}` : ''}`;
		this.#status.textContent = text;
	}
}
