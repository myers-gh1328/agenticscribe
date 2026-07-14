<script lang="ts">
	import { onMount } from 'svelte';
	import { installGuidance, isInstalledDisplayMode, type InstallGuidance } from '../install-guidance';

	const dismissalKey = 'agenticscribe.install-invitation-dismissed';

	interface BeforeInstallPromptEvent extends Event {
		prompt(): Promise<unknown>;
	}

	let nativePrompt: BeforeInstallPromptEvent | undefined;
	let guidance: InstallGuidance | undefined;
	let visible = false;

	function dismiss() {
		localStorage.setItem(dismissalKey, 'true');
		visible = false;
		nativePrompt = undefined;
	}

	async function install() {
		if (!nativePrompt) return;
		const prompt = nativePrompt;
		dismiss();
		await prompt.prompt();
	}

	onMount(() => {
		const iosNavigator = navigator as Navigator & { standalone?: boolean };
		if (
			localStorage.getItem(dismissalKey) === 'true' ||
			isInstalledDisplayMode(matchMedia('(display-mode: standalone)'), iosNavigator.standalone === true)
		) return;

		guidance = installGuidance(navigator);
		visible = guidance !== undefined;

		const offerNativeInstall = (event: Event) => {
			event.preventDefault();
			nativePrompt = event as BeforeInstallPromptEvent;
			guidance = undefined;
			visible = true;
		};
		const installed = () => dismiss();
		window.addEventListener('beforeinstallprompt', offerNativeInstall);
		window.addEventListener('appinstalled', installed);

		return () => {
			window.removeEventListener('beforeinstallprompt', offerNativeInstall);
			window.removeEventListener('appinstalled', installed);
		};
	});
</script>

{#if visible}
	<section class="install-invitation" aria-labelledby="install-title">
		<button class="dismiss" type="button" aria-label="Dismiss install invitation" onclick={dismiss}>×</button>
		<h2 id="install-title">Install AgenticScribe</h2>
		{#if nativePrompt}
			<p>Keep it one tap away and open it like an app.</p>
			<button class="install" type="button" onclick={install}>Install app</button>
		{:else if guidance}
			<p><strong>{guidance.label}</strong></p>
			<p>{guidance.instructions}</p>
		{/if}
	</section>
{/if}

<style>
	.install-invitation {
		position: relative;
		margin-bottom: 14px;
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 9px;
		background: rgba(255, 255, 255, 0.06);
		padding: 12px;
		color: var(--sidebar-ink);
	}

	h2 {
		margin: 0 24px 5px 0;
		font-size: 14px;
		font-weight: 650;
	}

	p {
		margin: 4px 0 0;
		color: #d7d2c5;
		font-size: 12px;
		line-height: 1.4;
	}

	.dismiss {
		position: absolute;
		top: 6px;
		right: 6px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		padding: 2px 7px 4px;
		color: #d7d2c5;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
	}

	.install {
		width: 100%;
		margin-top: 10px;
		border: 0;
		border-radius: 7px;
		background: var(--sidebar-ink);
		padding: 8px 10px;
		color: var(--sidebar);
		font-weight: 650;
		cursor: pointer;
	}

	.dismiss:hover,
	.dismiss:focus-visible {
		background: var(--sidebar-hover);
	}

	.install:hover {
		background: #fffdf6;
	}

	.dismiss:focus-visible,
	.install:focus-visible {
		outline: 2px solid #c7b895;
		outline-offset: 2px;
	}
</style>
