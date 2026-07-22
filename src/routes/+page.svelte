<script lang="ts">
	import { onMount } from 'svelte';
	import { initializeNotebookApp } from '../notebook-app';
	import InstallPrompt from '../lib/InstallPrompt.svelte';
	import ThemeToggle from '../lib/ThemeToggle.svelte';
	import { initializePwaUpdates } from '../pwa-updates';
	import '@milkdown/crepe/theme/common/style.css';
	import '@milkdown/crepe/theme/classic.css';
	import '../agent-setup.css';
	import '../styles.css';

	onMount(() => {
		let destroyed = false;
		let destroyPwaUpdates: (() => void) | undefined;
		void initializeNotebookApp();
		if ('serviceWorker' in navigator) {
			void initializePwaUpdates()
				.then((updates) => {
					if (destroyed) updates.destroy();
					else destroyPwaUpdates = updates.destroy;
				})
				.catch(() => {});
		}
		return () => {
			destroyed = true;
			destroyPwaUpdates?.();
		};
	});
</script>

<svelte:head>
	<title>AgenticScribe — Note</title>
</svelte:head>

<div class="app-shell">
	<aside class="sidebar" aria-label="Notebook organization">
		<div class="sidebar-header">
			<h1 class="brand">AgenticScribe</h1>
			<ThemeToggle />
		</div>
		<button class="new-note" id="new-note" type="button">＋ New note</button>
		<button class="open-markdown" id="open-markdown" type="button" hidden>Open .md file</button>

		<nav aria-label="Notes and folders">
			<section class="sidebar-section">
				<button class="sidebar-item active" type="button" data-location="scratchpad">
					<span aria-hidden="true">⌂</span>
					Scratchpad
					<span class="count" id="scratchpad-count">1</span>
				</button>
			</section>

			<section class="sidebar-section" aria-labelledby="folders-label">
				<div class="folder-heading">
					<h2 class="section-label" id="folders-label">Folders</h2>
					<button class="add-root-folder" id="add-root-folder" type="button" aria-label="New folder">＋</button>
				</div>
				<div id="folder-list"></div>
			</section>

			<section class="sidebar-section" aria-labelledby="notes-label">
				<h2 class="section-label" id="notes-label"><span id="location-name">Scratchpad</span> notes</h2>
				<div id="notes-list"></div>
				<p class="empty-location" id="empty-location" hidden>No notes here yet.</p>
			</section>

			<section class="sidebar-section" id="local-files-section" aria-labelledby="local-files-label" hidden>
				<h2 class="section-label" id="local-files-label">Local files</h2>
				<div id="local-files-list"></div>
			</section>
		</nav>

		<div class="agent-setup-link">
			<InstallPrompt />
			<button class="sidebar-item" id="open-agent-setup" type="button">
				<span aria-hidden="true">✦</span>
				Agent setup
			</button>
		</div>
	</aside>

	<button class="sidebar-toggle" id="sidebar-toggle" type="button" aria-label="Open folders">☰</button>

	<div class="workspace">
		<main class="note" aria-label="Note">
			<header class="note-identity">
				<span>Current note</span>
				<div class="note-heading-row">
					<input id="note-title-display" aria-label="Note title" maxlength="120" value="Untitled note" />
					<div class="note-versions" id="note-versions" aria-label="Note version" hidden>
						<button id="show-raw-version" type="button" aria-pressed="true">Raw version</button>
						<button id="show-final-version" type="button" aria-pressed="false">Final version</button>
					</div>
					<div class="note-actions" aria-label="Note actions">
						<button id="voice-note" type="button" aria-label="Record voice note" hidden>🎙 Voice</button>
						<button id="distill-note" type="button">Distill note</button>
						<button id="export-note-markdown" type="button" aria-label="Export note as Markdown">Export .md</button>
						<button id="export-note-text" type="button" aria-label="Export note as text">Export .txt</button>
					</div>
				</div>
			</header>
			<div id="editor" aria-label="Continuous note editor"></div>
		</main>
		<div class="capture-state" id="capture-state" role="status" aria-live="polite">
			<span id="state-text">Nothing saved yet</span>
			<button id="save-thought" type="button">Save thought</button>
			<span class="shortcut">Enter saves + starts a new line · Shift + Enter adds a line without saving</span>
		</div>
	</div>

	<main class="setup-page" id="setup-page" hidden>
		<section class="setup-sheet" aria-labelledby="setup-title">
			<button class="setup-back" id="close-agent-setup" type="button">← Back to notes</button>
			<p class="setup-eyebrow">Private AI · deployment managed</p>
			<h2 id="setup-title">Use your deployment agent</h2>
			<p class="setup-intro">
				AgenticScribe will send only a newly saved thought to the agent for spelling and grammar cleanup.
				Your original thought stays preserved.
			</p>

			<form id="agent-setup-form">
				<div class="connection-card">
					<div class="connection-status">
						<strong>OpenAI-compatible agent</strong>
						<span class="status-pill" id="agent-status" role="status">Not connected</span>
					</div>

					<p class="deployment-detail">
						Connection and model routing are managed by this deployment.
						<span id="agent-model">Configured by the operator</span>
					</p>

					<label class="setup-option">
						<input name="automaticCleanup" type="checkbox" checked />
						<span>
							Clean each thought after saving
							<small>Only spelling, grammar, capitalization, and punctuation.</small>
						</span>
					</label>
				</div>

				<p class="privacy-note">
					Only the automatic-cleanup preference stays in this browser. AgenticScribe continues to take notes when the agent is unavailable.
				</p>
				<div class="setup-actions">
					<p>Only newly saved thoughts are sent for cleanup.</p>
					<button class="connect-agent" type="submit">Test connection</button>
				</div>
			</form>
		</section>
	</main>
</div>

<dialog class="confirm-dialog" id="delete-dialog" aria-labelledby="delete-dialog-title">
	<div class="confirm-content">
		<p class="confirm-eyebrow">Permanent action</p>
		<h2 id="delete-dialog-title">Delete this note?</h2>
		<p class="confirm-copy"><strong id="delete-note-name"></strong> will be removed from this device.</p>
		<div class="confirm-actions">
			<button id="cancel-delete" type="button">Keep note</button>
			<button class="confirm-delete" id="confirm-delete" type="button">Delete note</button>
		</div>
	</div>
</dialog>

<dialog class="voice-dialog" id="voice-dialog" aria-labelledby="voice-dialog-title">
	<section class="voice-sheet">
		<header>
			<div>
				<p class="distill-eyebrow">Self-hosted transcription</p>
				<h2 id="voice-dialog-title">Voice note</h2>
			</div>
			<button id="close-voice" class="distill-close" type="button" aria-label="Close voice note">×</button>
		</header>
		<p class="distill-disclosure">Audio stays on this device until you choose Transcribe, is sent only to your self-hosted model, and is discarded after transcription.</p>
		<p id="voice-status" class="voice-status" role="status" aria-live="polite">Ready to record.</p>
		<footer>
			<button id="start-voice" class="distill-primary" type="button">Start recording</button>
			<button id="stop-voice" class="voice-stop" type="button" hidden>Stop recording</button>
			<button id="transcribe-voice" class="distill-primary" type="button" hidden>Transcribe recording</button>
		</footer>
	</section>
</dialog>

<dialog class="distill-dialog" id="distill-dialog" aria-labelledby="distill-dialog-title">
	<section class="distill-sheet">
		<header>
			<div>
				<p class="distill-eyebrow">AI distillation</p>
				<h2 id="distill-dialog-title">Distilled note</h2>
			</div>
			<button id="close-distill" class="distill-close" type="button" aria-label="Close distillation">×</button>
		</header>
		<p class="distill-disclosure">The entire current note is sent to your deployment-managed agent.</p>
		<label class="distill-option"><input id="include-distill-summary" type="checkbox" /> Include summary</label>
		<p id="distill-status" class="distill-status" role="status" aria-live="polite">Choose your options, then organize the note.</p>
		<pre id="distill-result" class="distill-result" hidden></pre>
		<footer>
			<button id="run-distillation" class="distill-primary" type="button">Organize note</button>
			<button id="save-distilled-note" class="distill-primary" type="button" hidden disabled>Use as final version</button>
			<button id="export-distilled-markdown" type="button" disabled>Export distilled Markdown</button>
			<button id="export-distilled-text" type="button" disabled>Export distilled text</button>
		</footer>
	</section>
</dialog>
