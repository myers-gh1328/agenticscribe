import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import { replaceAll } from '@milkdown/kit/utils';

type EditorEvent = 'input' | 'keydown';
type EditorListener = (event: Event) => void;

const toolbarLabels = [
	'Bold',
	'Italic',
	'Strikethrough',
	'Inline code',
	'Bullet list',
	'Numbered list',
	'Task list',
	'Link',
	'Code block',
	'Quote',
	'Horizontal rule'
];

export class MarkdownEditor {
	readonly #crepe: Crepe;
	readonly #root: HTMLElement;
	readonly #listeners = new Map<EditorEvent, Set<EditorListener>>();
	#source: HTMLTextAreaElement | undefined;
	#visualButton: HTMLButtonElement | undefined;
	#markdownButton: HTMLButtonElement | undefined;
	#mode: 'visual' | 'markdown' = 'visual';
	#value = '';
	#replacing = false;
	#ignoredMarkdown: string | undefined;

	private constructor(root: HTMLElement) {
		this.#root = root;
		this.#crepe = new Crepe({
			root,
			features: {
				[Crepe.Feature.TopBar]: true,
				[Crepe.Feature.AI]: false,
				[Crepe.Feature.ImageBlock]: false,
				[Crepe.Feature.Table]: false,
				[Crepe.Feature.Latex]: false
			}
		});
		this.#root.dataset.markdown = '';
	}

	static async create(root: HTMLElement) {
		const editor = new MarkdownEditor(root);
		editor.#crepe.on((listener) => {
			listener.markdownUpdated((_ctx, markdown) => {
				if (editor.#replacing) return;
				if (editor.#ignoredMarkdown === markdown) {
					editor.#ignoredMarkdown = undefined;
					return;
				}
				editor.#syncValue(markdown);
				editor.#emit('input', new Event('input'));
			});
		});
		await editor.#crepe.create();
		editor.#configureDom();
		return editor;
	}

	get value() {
		return this.#value;
	}

	set value(markdown: string) {
		this.#syncValue(markdown);
		if (this.#source) this.#source.value = markdown;
		this.#replacing = true;
		try {
			this.#crepe.editor.action(replaceAll(markdown));
			if (markdown.endsWith('\n')) {
				this.#crepe.editor.action((ctx) => {
					const view = ctx.get(editorViewCtx);
					const last = view.state.doc.lastChild;
					if (last?.type.name === 'paragraph' && last.content.size === 0) return;
					const paragraph = view.state.schema.nodes.paragraph;
					if (!paragraph) return;
					view.dispatch(view.state.tr.insert(view.state.doc.content.size, paragraph.create()));
				});
			}
			this.#ignoredMarkdown = this.#crepe.getMarkdown();
		} finally {
			this.#replacing = false;
		}
	}

	set disabled(disabled: boolean) {
		this.#crepe.setReadonly(disabled);
		if (this.#source) this.#source.disabled = disabled;
		this.#root.toggleAttribute('aria-busy', disabled);
	}

	focus() {
		if (this.#mode === 'markdown') {
			this.#source?.focus();
			return;
		}
		this.#crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus());
	}

	fit() {
		// ProseMirror grows with its document; CSS owns its minimum viewport height.
	}

	addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
	addEventListener(type: 'input', listener: (event: Event) => void): void;
	addEventListener(
		type: EditorEvent,
		listener: ((event: KeyboardEvent) => void) | ((event: Event) => void)
	) {
		let listeners = this.#listeners.get(type);
		if (!listeners) {
			listeners = new Set();
			this.#listeners.set(type, listeners);
		}
		listeners.add(listener as EditorListener);
	}

	#emit(type: EditorEvent, event: Event) {
		this.#listeners.get(type)?.forEach((listener) => listener(event));
	}

	#syncValue(markdown: string) {
		this.#value = markdown;
		this.#root.dataset.markdown = markdown;
	}

	#configureDom() {
		const milkdown = this.#root.querySelector<HTMLElement>('.milkdown');
		const editable = this.#root.querySelector<HTMLElement>('.milkdown .editor');
		if (editable) editable.ariaLabel = 'Continuous note';

		this.#root.querySelectorAll<HTMLButtonElement>('.top-bar-item').forEach((button, index) => {
			const label = toolbarLabels[index];
			if (!label) return;
			button.ariaLabel = label;
			button.title = label;
		});

		const modeSwitch = document.createElement('div');
		modeSwitch.className = 'editor-mode-switch';
		modeSwitch.setAttribute('role', 'group');
		modeSwitch.setAttribute('aria-label', 'Editor view');

		this.#visualButton = document.createElement('button');
		this.#visualButton.type = 'button';
		this.#visualButton.textContent = 'Visual';
		this.#visualButton.setAttribute('aria-pressed', 'true');

		this.#markdownButton = document.createElement('button');
		this.#markdownButton.type = 'button';
		this.#markdownButton.textContent = 'Markdown';
		this.#markdownButton.setAttribute('aria-pressed', 'false');

		modeSwitch.append(this.#visualButton, this.#markdownButton);
		this.#root.append(modeSwitch);

		this.#source = document.createElement('textarea');
		this.#source.className = 'markdown-source';
		this.#source.ariaLabel = 'Raw Markdown';
		this.#source.spellcheck = false;
		this.#source.hidden = true;
		this.#root.append(this.#source);

		this.#source.addEventListener('input', () => {
			this.#syncValue(this.#source!.value);
			this.#emit('input', new Event('input'));
		});
		this.#markdownButton.addEventListener('click', () => {
			this.#syncValue(this.#crepe.getMarkdown());
			this.#mode = 'markdown';
			this.#source!.value = this.#value;
			if (milkdown) milkdown.hidden = true;
			this.#source!.hidden = false;
			this.#visualButton!.setAttribute('aria-pressed', 'false');
			this.#markdownButton!.setAttribute('aria-pressed', 'true');
			this.#source!.focus();
		});
		this.#visualButton.addEventListener('click', () => {
			this.value = this.#source!.value;
			this.#mode = 'visual';
			this.#source!.hidden = true;
			if (milkdown) milkdown.hidden = false;
			this.#visualButton!.setAttribute('aria-pressed', 'true');
			this.#markdownButton!.setAttribute('aria-pressed', 'false');
			this.focus();
		});

		this.#root.addEventListener('keydown', (event) => {
			if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
			if (!(event.target instanceof Element)) return;
			const button = event.target.closest<HTMLButtonElement>(
				'.top-bar-item, .top-bar-heading-button, .top-bar-heading-option'
			);
			if (!button) return;
			event.preventDefault();
			button.dispatchEvent(new PointerEvent('pointerdown', {
				bubbles: true,
				cancelable: true,
				button: 0,
				pointerType: 'mouse'
			}));
		}, true);

		this.#root.addEventListener('keydown', (event) => {
			if (!(event.target instanceof Element)) return;
			if (!event.target.closest('.milkdown .editor, .markdown-source')) return;
			this.#emit('keydown', event);
		}, true);
	}
}
