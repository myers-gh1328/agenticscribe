import {
	createPwaLifecycle,
	mountPwaUpdatePrompt,
	type PwaLifecycleOptions,
	type PwaUpdatePromptOptions
} from '@myers-gh1328/pwa-lifecycle';

export interface AgenticScribePwaOptions extends PwaLifecycleOptions {
	document?: Document;
}

export async function initializePwaUpdates(options: AgenticScribePwaOptions = {}) {
	const lifecycle = createPwaLifecycle(options);
	await lifecycle.start({ scriptUrl: '/sw.js' });
	const promptOptions: PwaUpdatePromptOptions = {
		document: options.document,
		title: 'AgenticScribe update ready',
		message: 'A newer version is ready. Update now to restart with the latest app.',
		updateLabel: 'Update AgenticScribe',
		laterLabel: 'Later'
	};
	const prompt = mountPwaUpdatePrompt(lifecycle, promptOptions);

	return {
		lifecycle,
		prompt,
		destroy: () => prompt.destroy()
	};
}
