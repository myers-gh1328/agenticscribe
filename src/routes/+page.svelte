<script lang="ts">
	import { onMount } from 'svelte';
	import { initializeNotebookApp } from '../notebook-app';
	import InstallPrompt from '../lib/InstallPrompt.svelte';
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
		<h1 class="brand">AgenticScribe</h1>
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
				<h2 id="note-title-display">Untitled note</h2>
			</header>
			<div id="editor" aria-label="Continuous note editor"></div>
		</main>
		<div class="capture-state" id="capture-state" role="status" aria-live="polite">
			<span id="state-text">Nothing saved yet</span>
			<button id="save-thought" type="button">Save thought</button>
			<span class="shortcut">⌘/Ctrl + Enter saves</span>
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
