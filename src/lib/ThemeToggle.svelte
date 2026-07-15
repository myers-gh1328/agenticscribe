<script lang="ts">
	import { onMount } from 'svelte';

	const preferenceKey = 'agenticscribe-theme';
	let dark = false;

	function applyTheme(nextDark: boolean) {
		dark = nextDark;
		document.documentElement.dataset.theme = dark ? 'dark' : 'light';
	}

	function toggleTheme() {
		applyTheme(!dark);
		localStorage.setItem(preferenceKey, dark ? 'dark' : 'light');
	}

	onMount(() => {
		applyTheme(document.documentElement.dataset.theme === 'dark');
	});
</script>

<button
	type="button"
	class="theme-toggle sidebar-item"
	role="switch"
	aria-label={dark ? 'Use light mode' : 'Use dark mode'}
	aria-checked={dark}
	onclick={toggleTheme}
>
	<svg class="theme-icon moon" aria-hidden="true" viewBox="0 0 20 20">
		<path d="M15.6 12.8A6.6 6.6 0 0 1 7.2 4.4 6.6 6.6 0 1 0 15.6 12.8Z"></path>
	</svg>
	<svg class="theme-icon sun" aria-hidden="true" viewBox="0 0 20 20">
		<circle cx="10" cy="10" r="3.1"></circle>
		<path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M15.8 4.2l-1.4 1.4M5.6 14.4l-1.4 1.4"></path>
	</svg>
	<span class="theme-thumb" aria-hidden="true"></span>
</button>
