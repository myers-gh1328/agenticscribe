<script lang="ts">
	import { onMount } from 'svelte';
	import { Crepe } from '@milkdown/crepe';
	import '@milkdown/crepe/theme/common/style.css';
	import '@milkdown/crepe/theme/classic.css';
	import './demo.css';

	let editorRoot: HTMLDivElement;

	onMount(() => {
		const crepe = new Crepe({
			root: editorRoot,
			defaultValue: `# A calmer way to capture

Milkdown turns Markdown into a document you can shape directly—while the underlying file stays portable.

## Try the toolbar

Select these words to see the contextual controls, or use the fixed toolbar above for formatting you can discover without memorizing syntax.

- Turn a thought into a list
- Add **emphasis** where it matters
- Link an idea to its source

> This is an isolated prototype. Nothing you type here is saved or synchronized.
`,
			features: {
				[Crepe.Feature.TopBar]: true,
				[Crepe.Feature.AI]: false
			}
		});

		void crepe.create().then(() => {
			const labels = [
				'Bold',
				'Italic',
				'Strikethrough',
				'Inline code',
				'Bullet list',
				'Numbered list',
				'Task list',
				'Link',
				'Image',
				'Table',
				'Code block',
				'Math',
				'Quote',
				'Horizontal rule'
			];
			editorRoot.querySelectorAll<HTMLButtonElement>('.top-bar-item').forEach((button, index) => {
				const label = labels[index];
				if (!label) return;
				button.ariaLabel = label;
				button.title = label;
			});
		});
		return () => void crepe.destroy();
	});
</script>

<svelte:head>
	<title>AgenticScribe — Milkdown prototype</title>
	<meta name="description" content="A temporary toolbar-enabled Milkdown editor prototype for AgenticScribe." />
</svelte:head>

<main class="demo-shell">
	<header class="demo-header">
		<a class="wordmark" href="/" aria-label="Back to AgenticScribe">AgenticScribe</a>
		<div class="prototype-stamp" aria-label="Prototype">Editor study · 01</div>
	</header>

	<section class="intro" aria-labelledby="demo-title">
		<p class="eyebrow">Milkdown + Crepe</p>
		<h1 id="demo-title">Markdown, without<br />the memorization.</h1>
		<p class="lede">
			A hands-on study of a richer writing surface with visible formatting controls.
			The document below is yours to pull apart.
		</p>
	</section>

	<section class="editor-stage" aria-label="Milkdown editor prototype">
		<div class="stage-label">
			<span>Working note</span>
			<span class="status-dot">Prototype only · nothing is saved</span>
		</div>
		<div class="editor-frame" bind:this={editorRoot}></div>
	</section>

	<footer class="demo-footer">
		<p><strong>Things to try</strong></p>
		<p>Select text for the floating toolbar · Type <kbd>/</kbd> for blocks · Use the fixed bar for everything else</p>
	</footer>
</main>
