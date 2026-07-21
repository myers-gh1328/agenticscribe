import { AgentSetup } from './agent-setup';
import { requireElement } from './dom';
import {
	NotebookStore,
	NotebookConflictError,
	type StoredFolder,
	type ThoughtBoundary
} from './notebook-store';
import { initializeNotebookIdentity, notebookDatabaseName } from './auth-bootstrap';
import { HttpNotebookRemote } from './notebook-remote';
import { appendThought, applyThoughtCleanup } from './thoughts';
import {
	BrowserMarkdownFile,
	LocalFilePermissionError,
	pickLocalMarkdownHandle,
	supportsLocalMarkdownFiles
} from './browser-markdown-file';
import { LocalMarkdownConflictError, LocalMarkdownDocument } from './local-markdown-document';
import { LocalMarkdownStore, type LocalMarkdownBinding } from './local-markdown-store';
import { MarkdownEditor } from './markdown-editor';
import { LocalAgent } from './local-agent';
import { downloadNote } from './note-export';
import { VoiceRecorder } from './voice-recorder';

interface NotebookNote {
	id: string;
	title: string;
	savedText: string;
	finalText?: string;
	thoughts: ThoughtBoundary[];
	location: string;
	persisted: boolean;
}

let initialized = false;

export async function initializeNotebookApp() {
	if (initialized) return;
	initialized = true;

const editorRoot = requireElement<HTMLElement>('#editor');
const editor = await MarkdownEditor.create(editorRoot);
const state = requireElement<HTMLElement>('#capture-state');
const stateText = requireElement<HTMLElement>('#state-text');
const saveThought = requireElement<HTMLButtonElement>('#save-thought');
const newNote = requireElement<HTMLButtonElement>('#new-note');
const openMarkdown = requireElement<HTMLButtonElement>('#open-markdown');
const localFilesSection = requireElement<HTMLElement>('#local-files-section');
const localFilesList = requireElement<HTMLElement>('#local-files-list');
const sidebarToggle = requireElement<HTMLButtonElement>('#sidebar-toggle');
const notesList = requireElement<HTMLElement>('#notes-list');
const emptyLocation = requireElement<HTMLElement>('#empty-location');
const locationName = requireElement<HTMLElement>('#location-name');
const noteTitleDisplay = requireElement<HTMLInputElement>('#note-title-display');
const noteVersions = requireElement<HTMLElement>('#note-versions');
const showRawVersion = requireElement<HTMLButtonElement>('#show-raw-version');
const showFinalVersion = requireElement<HTMLButtonElement>('#show-final-version');
const distillNote = requireElement<HTMLButtonElement>('#distill-note');
const voiceNote = requireElement<HTMLButtonElement>('#voice-note');
const exportNoteMarkdown = requireElement<HTMLButtonElement>('#export-note-markdown');
const exportNoteText = requireElement<HTMLButtonElement>('#export-note-text');
const scratchpadCount = requireElement<HTMLElement>('#scratchpad-count');
const folderList = requireElement<HTMLElement>('#folder-list');
const addRootFolder = requireElement<HTMLButtonElement>('#add-root-folder');
const deleteDialog = requireElement<HTMLDialogElement>('#delete-dialog');
const deleteNoteName = requireElement<HTMLElement>('#delete-note-name');
const cancelDelete = requireElement<HTMLButtonElement>('#cancel-delete');
const confirmDelete = requireElement<HTMLButtonElement>('#confirm-delete');
const distillDialog = requireElement<HTMLDialogElement>('#distill-dialog');
const distillDialogTitle = requireElement<HTMLElement>('#distill-dialog-title');
const distillStatus = requireElement<HTMLElement>('#distill-status');
const distillResult = requireElement<HTMLElement>('#distill-result');
const closeDistill = requireElement<HTMLButtonElement>('#close-distill');
const includeDistillSummary = requireElement<HTMLInputElement>('#include-distill-summary');
const runDistillation = requireElement<HTMLButtonElement>('#run-distillation');
const saveDistilledNote = requireElement<HTMLButtonElement>('#save-distilled-note');
const exportDistilledMarkdown = requireElement<HTMLButtonElement>('#export-distilled-markdown');
const exportDistilledText = requireElement<HTMLButtonElement>('#export-distilled-text');
const voiceDialog = requireElement<HTMLDialogElement>('#voice-dialog');
const voiceStatus = requireElement<HTMLElement>('#voice-status');
const closeVoice = requireElement<HTMLButtonElement>('#close-voice');
const startVoice = requireElement<HTMLButtonElement>('#start-voice');
const stopVoice = requireElement<HTMLButtonElement>('#stop-voice');
const transcribeVoice = requireElement<HTMLButtonElement>('#transcribe-voice');
const workspace = requireElement<HTMLElement>('.workspace');
const setupPage = requireElement<HTMLElement>('#setup-page');
await initializeNotebookIdentity();
const store = new NotebookStore({ databaseName: notebookDatabaseName() });
const localMarkdownStore = new LocalMarkdownStore();
const remote = new HttpNotebookRemote();
let syncQueue = Promise.resolve(false);
let syncConflict = false;
let serverDurable = await synchronizeNotebook();
let folders: StoredFolder[] = await store.listFolders();
const storedNotes = await store.listNotes();
const storedDrafts = await store.listDrafts();
let localBindings = await localMarkdownStore.list();
let activeLocal: { binding: LocalMarkdownBinding; document: LocalMarkdownDocument } | undefined;
let notes: NotebookNote[] = storedNotes.map((note) => ({
	id: note.id,
	title: note.title?.trim() || 'Untitled note',
	savedText: note.text,
	finalText: note.finalText,
	thoughts: note.thoughts,
	location: note.location,
	persisted: true
}));
for (const draft of storedDrafts) {
	if (notes.some((note) => note.id === draft.noteId)) continue;
	notes.push({
		id: draft.noteId,
		title: 'Untitled note',
		savedText: '',
		thoughts: [],
		location: draft.location,
		persisted: false
	});
}
const drafts = new Map(notes.map((note) => [note.id, note.savedText]));
for (const draft of storedDrafts) drafts.set(draft.noteId, draft.text);
let activeNoteId = notes[0]?.id;
let selectedLocation = notes[0]?.location ?? 'scratchpad';
let creatingParentId: string | null | undefined;
let renamingFolderId: string | undefined;
let stateTimer: ReturnType<typeof setTimeout> | undefined;
let pendingDeleteNoteId: string | undefined;
let deleteReturnFocus: HTMLElement | undefined;
let distilledMarkdown = '';
let distilledSourceTitle = '';
let viewingFinal = false;
let voiceRecorder: VoiceRecorder | undefined;
let voiceSegments: Blob[] = [];

function createId() {
	return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function activeNote(): NotebookNote | undefined {
	return notes.find((note) => note.id === activeNoteId);
}

function currentText(note: NotebookNote) {
	return drafts.get(note.id) ?? note.savedText;
}

function noteTitle(note: NotebookNote) {
	return note.title.trim() || 'Untitled note';
}

function displayedNoteTitle() {
	if (activeLocal) return activeLocal.binding.name.replace(/\.md$/i, '') || 'Untitled note';
	const note = activeNote();
	return note ? noteTitle(note).replace(/^#{1,6}\s+/, '') : 'Untitled note';
}

function renderNoteTitle() {
	noteTitleDisplay.value = displayedNoteTitle();
	noteTitleDisplay.disabled = Boolean(activeLocal);
	distillNote.disabled = Boolean(activeLocal);
	distillNote.title = activeLocal ? 'Local files stay on this device and cannot be sent for distillation.' : '';
	voiceNote.disabled = Boolean(activeLocal);
	voiceNote.title = activeLocal ? 'Local files stay on this device and cannot be sent for transcription.' : '';
}

function renderVersion() {
	const note = activeNote();
	const hasFinal = Boolean(!activeLocal && note?.finalText);
	noteVersions.hidden = !hasFinal;
	if (!hasFinal) viewingFinal = false;
	showRawVersion.setAttribute('aria-pressed', String(!viewingFinal));
	showFinalVersion.setAttribute('aria-pressed', String(viewingFinal));
	editor.disabled = viewingFinal;
	saveThought.disabled = viewingFinal;
}

function showVersion(final: boolean) {
	const note = activeNote();
	if (!note || activeLocal || (final && !note.finalText)) return;
	if (!viewingFinal) drafts.set(note.id, editor.value);
	viewingFinal = final;
	editor.value = final ? `${note.finalText!.replace(/\n?$/, '\n')}` : currentText(note);
	renderVersion();
	fitEditor();
}

function localRecovery(binding: LocalMarkdownBinding) {
	return {
		save: (text: string) => localMarkdownStore.saveRecovery(binding.id, text),
		clear: (text: string) => localMarkdownStore.clearRecovery(binding.id, text)
	};
}

async function activateLocalFile(binding: LocalMarkdownBinding, requestPermission = false) {
	const current = activeNote();
	if (!activeLocal && current) drafts.set(current.id, editor.value);
	const file = new BrowserMarkdownFile(binding.handle);
	try {
		if (requestPermission) await file.requestAccess();
		const document = await LocalMarkdownDocument.open(file, localRecovery(binding));
		activeLocal = { binding, document };
		editor.value = binding.recoveryText ?? document.text;
		state.classList.remove('saved');
		stateText.textContent = binding.recoveryText
			? 'Recovered local edits — use Save thought to save'
			: 'Local file — changes stay on this device';
		renderLocation();
		renderLocalFiles();
		globalThis.document.body.classList.remove('sidebar-open');
		fitEditor();
		editor.focus();
	} catch (error) {
		state.classList.remove('saved');
		stateText.textContent = error instanceof LocalFilePermissionError
			? 'Permission needed — select the local file again'
			: 'Local file unavailable — recovery preserved';
	}
}

function renderLocalFiles() {
	localFilesSection.hidden = localBindings.length === 0;
	localFilesList.replaceChildren();
	for (const binding of localBindings) {
		const row = document.createElement('div');
		row.className = 'local-file-row';
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'note-link';
		button.classList.toggle('active', activeLocal?.binding.id === binding.id);
		button.textContent = binding.name;
		button.addEventListener('click', () => void activateLocalFile(binding, true));
		const unlink = document.createElement('button');
		unlink.type = 'button';
		unlink.className = 'unlink-local-file';
		unlink.setAttribute('aria-label', `Unlink ${binding.name}`);
		unlink.textContent = '×';
		unlink.addEventListener('click', async () => {
			await localMarkdownStore.remove(binding.id);
			localBindings = localBindings.filter((candidate) => candidate.id !== binding.id);
			if (activeLocal?.binding.id === binding.id) {
				activeLocal = undefined;
				const note = activeNote();
				editor.value = note ? currentText(note) : '';
				stateText.textContent = note?.persisted ? savedStateText() : 'Nothing saved yet';
			}
			renderLocalFiles();
			renderLocation();
		});
		row.append(button, unlink);
		localFilesList.append(row);
	}
}

async function openLocalMarkdown() {
	try {
		const handle = await pickLocalMarkdownHandle();
		const file = new BrowserMarkdownFile(handle);
		await file.requestAccess();
		const document = await LocalMarkdownDocument.open(file, {
			save: async () => undefined,
			clear: async () => undefined
		});
		const binding: LocalMarkdownBinding = {
			id: `local-${crypto.randomUUID()}`,
			name: handle.name,
			handle,
			text: document.text,
			recoveryText: null
		};
		await localMarkdownStore.bind(binding);
		localBindings = [binding, ...localBindings];
		await activateLocalFile(binding);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') return;
		stateText.textContent = 'Could not open the local Markdown file';
	}
}

function locationLabel(id: string) {
	if (id === 'scratchpad') return 'Scratchpad';
	return folders.find((folder) => folder.id === id)?.name ?? 'Scratchpad';
}

function folderDepth(folder: StoredFolder) {
	let depth = 0;
	let parentId = folder.parentId;
	while (parentId && depth < 8) {
		depth += 1;
		parentId = folders.find((candidate) => candidate.id === parentId)?.parentId ?? null;
	}
	return depth;
}

function orderedFolders(parentId: string | null = null): StoredFolder[] {
	return folders
		.filter((folder) => folder.parentId === parentId)
		.flatMap((folder) => [folder, ...orderedFolders(folder.id)]);
}

function createFolderForm(parentId: string | null, depth: number, existingFolder?: StoredFolder) {
	const form = document.createElement('form');
	form.className = 'folder-form';
	form.style.paddingLeft = `${10 + depth * 18}px`;
	const input = document.createElement('input');
	input.type = 'text';
	input.maxLength = 40;
	input.required = true;
	input.setAttribute('aria-label', existingFolder ? `Rename ${existingFolder.name}` : 'Folder name');
	input.placeholder = existingFolder ? '' : 'Folder name';
	input.value = existingFolder?.name ?? '';
	const save = document.createElement('button');
	save.type = 'submit';
	save.textContent = 'Save';
	const cancel = document.createElement('button');
	cancel.type = 'button';
	cancel.textContent = 'Cancel';
	cancel.addEventListener('click', () => {
		creatingParentId = undefined;
		renamingFolderId = undefined;
		renderFolders();
	});
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const name = input.value.trim();
		const duplicate = folders.some((folder) =>
			folder.id !== existingFolder?.id &&
			folder.parentId === parentId &&
			folder.name.toLocaleLowerCase() === name.toLocaleLowerCase()
		);
		if (!name || duplicate) {
			input.setCustomValidity(duplicate ? 'A folder with that name already exists here.' : 'Enter a folder name.');
			input.reportValidity();
			return;
		}
		if (existingFolder) await store.renameFolder(existingFolder.id, name);
		else await store.createFolder({ id: `folder-${crypto.randomUUID()}`, name, parentId });
		serverDurable = await synchronizeNotebook();
		folders = await store.listFolders();
		creatingParentId = undefined;
		renamingFolderId = undefined;
		renderFolders();
	});
	input.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			creatingParentId = undefined;
			renamingFolderId = undefined;
			renderFolders();
		}
	});
	form.append(input, save, cancel);
	requestAnimationFrame(() => {
		input.focus();
		input.select();
	});
	return form;
}

function closeMoveMenus(except?: HTMLElement) {
	document.querySelectorAll<HTMLElement>('.move-menu').forEach((menu) => {
		if (menu !== except) menu.hidden = true;
	});
	document.querySelectorAll<HTMLButtonElement>('.note-menu-button').forEach((button) => {
		if (!except || button.nextElementSibling !== except) button.setAttribute('aria-expanded', 'false');
	});
}

function attachLocationBehavior(button: HTMLButtonElement) {
	button.addEventListener('click', () => {
		selectedLocation = button.dataset.location ?? 'scratchpad';
		closeMoveMenus();
		renderLocation();
	});
	button.addEventListener('dragover', (event) => {
		event.preventDefault();
		button.classList.add('drop-target');
	});
	button.addEventListener('dragleave', () => button.classList.remove('drop-target'));
	button.addEventListener('drop', (event) => {
		event.preventDefault();
		button.classList.remove('drop-target');
		const noteId = event.dataTransfer?.getData('text/plain').replace(/^note:/, '');
		if (noteId) moveNote(noteId, button.dataset.location ?? 'scratchpad');
	});
}

function renderFolders() {
	folderList.replaceChildren();
	if (creatingParentId === null) folderList.append(createFolderForm(null, 0));
	for (const folder of orderedFolders()) {
		const depth = folderDepth(folder);
		if (renamingFolderId === folder.id) {
			folderList.append(createFolderForm(folder.parentId, depth, folder));
		} else {
			const row = document.createElement('div');
			row.className = 'folder-row';
			const button = document.createElement('button');
			button.className = 'sidebar-item';
			button.type = 'button';
			button.dataset.location = folder.id;
			button.style.paddingLeft = `${10 + depth * 18}px`;
			const marker = document.createElement('span');
			marker.className = 'folder-mark';
			marker.setAttribute('aria-hidden', 'true');
			marker.textContent = folders.some((candidate) => candidate.parentId === folder.id) ? '▾' : '—';
			button.append(marker, document.createTextNode(folder.name));
			attachLocationBehavior(button);
			const actions = document.createElement('span');
			actions.className = 'folder-actions';
			const addChild = document.createElement('button');
			addChild.className = 'folder-action';
			addChild.type = 'button';
			addChild.textContent = '＋';
			addChild.setAttribute('aria-label', `New folder inside ${folder.name}`);
			addChild.addEventListener('click', () => {
				creatingParentId = folder.id;
				renamingFolderId = undefined;
				renderFolders();
			});
			const rename = document.createElement('button');
			rename.className = 'folder-action';
			rename.type = 'button';
			rename.textContent = '✎';
			rename.setAttribute('aria-label', `Rename ${folder.name}`);
			rename.addEventListener('click', () => {
				renamingFolderId = folder.id;
				creatingParentId = undefined;
				renderFolders();
			});
			actions.append(addChild, rename);
			row.append(button, actions);
			folderList.append(row);
		}
		if (creatingParentId === folder.id) folderList.append(createFolderForm(folder.id, depth + 1));
	}
	renderLocation();
}

function createMoveMenu(note: NotebookNote, button: HTMLButtonElement) {
	const menu = document.createElement('div');
	menu.className = 'move-menu';
	menu.role = 'menu';
	menu.hidden = true;
	const title = document.createElement('p');
	title.className = 'move-menu-title';
	title.textContent = 'Move to…';
	menu.append(title);
	for (const location of [
		{ id: 'scratchpad', name: 'Scratchpad', depth: 0 },
		...orderedFolders().map((folder) => ({ id: folder.id, name: folder.name, depth: folderDepth(folder) }))
	]) {
		const option = document.createElement('button');
		option.className = 'move-option';
		option.type = 'button';
		option.role = 'menuitem';
		option.textContent = `${'  '.repeat(location.depth)}${location.name}`;
		option.addEventListener('click', () => moveNote(note.id, location.id));
		menu.append(option);
	}
	const divider = document.createElement('hr');
	divider.className = 'menu-divider';
	const deleteButton = document.createElement('button');
	deleteButton.className = 'move-option delete-option';
	deleteButton.type = 'button';
	deleteButton.role = 'menuitem';
	deleteButton.textContent = 'Delete note';
	deleteButton.addEventListener('click', () => openDeleteDialog(note.id, button));
	menu.append(divider, deleteButton);
	button.addEventListener('click', (event) => {
		event.stopPropagation();
		const opening = menu.hidden;
		closeMoveMenus(opening ? menu : undefined);
		menu.hidden = !opening;
		button.setAttribute('aria-expanded', String(opening));
		if (opening) menu.querySelector<HTMLButtonElement>('.move-option')?.focus();
	});
	return menu;
}

function renderNotes() {
	renderNoteTitle();
	notesList.replaceChildren();
	const visibleNotes = notes.filter((note) => note.location === selectedLocation);
	for (const note of visibleNotes) {
		const row = document.createElement('div');
		row.className = 'note-row';
		const link = document.createElement('button');
		link.className = 'note-link';
		link.classList.toggle('active', !activeLocal && note.id === activeNoteId);
		link.type = 'button';
		link.draggable = true;
		const titleWrap = document.createElement('span');
		titleWrap.className = 'note-title-wrap';
		const title = document.createElement('span');
		title.className = 'note-title';
		title.textContent = noteTitle(note);
		titleWrap.append(title);
		if (!note.persisted) {
			const unsaved = document.createElement('span');
			unsaved.className = 'unsaved-mark';
			unsaved.textContent = 'unsaved';
			titleWrap.append(unsaved);
		}
		link.append(titleWrap);
		link.addEventListener('click', () => selectNote(note.id));
		link.addEventListener('dragstart', (event) => {
			event.dataTransfer?.setData('text/plain', `note:${note.id}`);
			if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
			link.classList.add('dragging');
		});
		link.addEventListener('dragend', () => {
			link.classList.remove('dragging');
		document.querySelectorAll<HTMLElement>('[data-location]').forEach((item) => item.classList.remove('drop-target'));
		});
		const menuButton = document.createElement('button');
		menuButton.className = 'note-menu-button';
		menuButton.type = 'button';
		menuButton.setAttribute('aria-label', `Actions for ${noteTitle(note)}`);
		menuButton.setAttribute('aria-haspopup', 'menu');
		menuButton.setAttribute('aria-expanded', 'false');
		menuButton.textContent = '•••';
		row.append(link, menuButton, createMoveMenu(note, menuButton));
		notesList.append(row);
	}
	emptyLocation.hidden = visibleNotes.length > 0;
	scratchpadCount.textContent = String(notes.filter((note) => note.location === 'scratchpad').length);
}

function renderLocation() {
	const validLocations = new Set(['scratchpad', ...folders.map((folder) => folder.id)]);
	for (const note of notes) if (!validLocations.has(note.location)) note.location = 'scratchpad';
	if (!validLocations.has(selectedLocation)) selectedLocation = 'scratchpad';
	document.querySelectorAll<HTMLElement>('[data-location]').forEach((button) => {
		button.classList.toggle('active', button.dataset.location === selectedLocation);
	});
	locationName.textContent = locationLabel(selectedLocation);
	renderNotes();
}

function selectNote(noteId: string) {
	const wasLocal = activeLocal;
	activeLocal = undefined;
	const current = activeNote();
	if (current && !wasLocal) drafts.set(current.id, editor.value);
	const next = notes.find((note) => note.id === noteId);
	if (!next) return;
	activeNoteId = noteId;
	viewingFinal = false;
	selectedLocation = next.location;
	editor.value = currentText(next);
	renderVersion();
	state.classList.remove('saved');
	stateText.textContent = next.persisted ? savedStateText() : 'Nothing saved yet';
	renderLocation();
	renderLocalFiles();
	document.body.classList.remove('sidebar-open');
	fitEditor();
	editor.focus();
}

function createNewNote() {
	const wasLocal = activeLocal;
	activeLocal = undefined;
	const current = activeNote();
	if (current && !wasLocal) drafts.set(current.id, editor.value);
	if (current && !current.persisted && !currentText(current).trim()) {
		current.location = selectedLocation;
		renderLocation();
		document.body.classList.remove('sidebar-open');
		editor.focus();
		return;
	}
	const note = { id: createId(), title: 'Untitled note', savedText: '', thoughts: [], location: selectedLocation, persisted: false };
	notes.unshift(note);
	drafts.set(note.id, '');
	activeNoteId = note.id;
	viewingFinal = false;
	editor.value = '';
	renderVersion();
	state.classList.remove('saved');
	stateText.textContent = 'Nothing saved yet';
	renderLocation();
	renderLocalFiles();
	document.body.classList.remove('sidebar-open');
	fitEditor();
	editor.focus();
}

async function moveNote(noteId: string, destination: string) {
	const note = notes.find((candidate) => candidate.id === noteId);
	if (!note) return;
	note.location = destination;
	if (note.persisted) {
		await store.moveNote(note.id, destination);
		serverDurable = await synchronizeNotebook();
	}
	selectedLocation = destination;
	closeMoveMenus();
	renderLocation();
	clearTimeout(stateTimer);
	state.classList.add('saved');
	stateText.textContent = serverDurable
		? `Moved to ${locationLabel(destination)} and saved to server`
		: `Moved to ${locationLabel(destination)} offline — pending sync`;
	stateTimer = setTimeout(() => {
		state.classList.remove('saved');
		stateText.textContent = note.persisted ? savedStateText() : 'Nothing saved yet';
	}, 1100);
}

function openDeleteDialog(noteId: string, returnFocus: HTMLElement) {
	const note = notes.find((candidate) => candidate.id === noteId);
	if (!note) return;
	pendingDeleteNoteId = noteId;
	deleteReturnFocus = returnFocus;
	deleteNoteName.textContent = `“${noteTitle(note)}”`;
	closeMoveMenus();
	deleteDialog.showModal();
	cancelDelete.focus();
}

function closeDeleteDialog() {
	deleteDialog.close();
	pendingDeleteNoteId = undefined;
	if (deleteReturnFocus?.isConnected) deleteReturnFocus.focus();
	deleteReturnFocus = undefined;
}

async function deleteNote(noteId: string) {
	const index = notes.findIndex((note) => note.id === noteId);
	if (index < 0) return;
	const [deleted] = notes.splice(index, 1);
	if (!deleted) return;
	drafts.delete(noteId);
	if (deleted.persisted) await store.deleteNote(noteId);
	if (deleted.persisted) serverDurable = await synchronizeNotebook();
	if (activeNoteId === noteId) {
		const next = notes.find((note) => note.location === deleted.location) ?? notes[0];
		activeNoteId = undefined;
		if (next) selectNote(next.id);
		else {
			selectedLocation = deleted.location;
			createNewNote();
		}
	} else {
		renderLocation();
	}
	clearTimeout(stateTimer);
	state.classList.add('saved');
	stateText.textContent = serverDurable ? 'Note deleted from server' : 'Note deleted offline — pending sync';
	stateTimer = setTimeout(() => {
		state.classList.remove('saved');
		stateText.textContent = activeNote()?.persisted ? savedStateText() : 'Nothing saved yet';
	}, 1100);
}

function fitEditor() {
	editor.fit();
}

function showSaved(synchronized: boolean) {
	clearTimeout(stateTimer);
	state.classList.add('saved');
	stateText.textContent = syncConflict
		? 'Sync conflict — local copy preserved'
		: synchronized
		? 'Thought saved to server'
		: 'Thought saved offline — pending sync';
	stateTimer = setTimeout(() => {
		state.classList.remove('saved');
		stateText.textContent = savedStateText();
	}, 1100);
}

function savedStateText() {
	if (syncConflict) return 'Sync conflict — local copy preserved';
	return serverDurable ? 'Saved to server' : 'Saved offline — pending sync';
}

function synchronizeNotebook() {
	const attempt = syncQueue.then(async () => {
		try {
			await store.synchronize(remote);
			syncConflict = false;
			return true;
		} catch (error) {
			syncConflict = error instanceof NotebookConflictError;
			return false;
		}
	});
	syncQueue = attempt;
	return attempt;
}

async function refreshNotebookFromServer() {
	const activeBeforeRefresh = activeNote();
	const editorHasFocus = Boolean(document.activeElement && editorRoot.contains(document.activeElement));
	const activeHadLocalChanges = activeBeforeRefresh
		? editorHasFocus || drafts.get(activeBeforeRefresh.id) !== activeBeforeRefresh.savedText
		: false;
	const synchronized = await synchronizeNotebook();
	serverDurable = synchronized;
	if (!synchronized) return false;

	const [storedNotes, storedFolders] = await Promise.all([store.listNotes(), store.listFolders()]);
	const previousNotes = new Map(notes.map((note) => [note.id, note]));
	const refreshedNotes: NotebookNote[] = storedNotes.map((stored) => {
		const previous = previousNotes.get(stored.id);
		const hasLocalChanges = previous
			? (stored.id === activeNoteId && editorHasFocus) || drafts.get(stored.id) !== previous.savedText
			: false;
		if (!hasLocalChanges) drafts.set(stored.id, stored.text);
		return {
			id: stored.id,
			title: stored.title?.trim() || 'Untitled note',
			savedText: stored.text,
			finalText: stored.finalText,
			thoughts: stored.thoughts,
			location: stored.location,
			persisted: true
		};
	});
	for (const note of notes) {
		if (!note.persisted && !refreshedNotes.some((candidate) => candidate.id === note.id)) {
			refreshedNotes.push(note);
		}
	}
	const notesChanged = notes.length !== refreshedNotes.length || notes.some((note, index) => {
		const refreshed = refreshedNotes[index];
		return !refreshed
			|| note.id !== refreshed.id
			|| note.title !== refreshed.title
			|| note.savedText !== refreshed.savedText
			|| note.finalText !== refreshed.finalText
			|| note.location !== refreshed.location
			|| note.persisted !== refreshed.persisted
			|| JSON.stringify(note.thoughts) !== JSON.stringify(refreshed.thoughts);
	});
	const foldersChanged = folders.length !== storedFolders.length || folders.some((folder, index) => {
		const refreshed = storedFolders[index];
		return !refreshed
			|| folder.id !== refreshed.id
			|| folder.name !== refreshed.name
			|| folder.parentId !== refreshed.parentId;
	});
	notes = refreshedNotes;
	folders = storedFolders;

	if (!activeLocal && activeNoteId && !activeHadLocalChanges) {
		const refreshedActive = activeNote();
		if (refreshedActive) {
			const refreshedText = viewingFinal && refreshedActive.finalText
				? `${refreshedActive.finalText.replace(/\n?$/, '\n')}`
				: currentText(refreshedActive);
			if (editor.value !== refreshedText) editor.value = refreshedText;
		}
	}
	const organizerInteractionActive = Boolean(
		document.querySelector('.move-menu:not([hidden]), .folder-form')
	);
	if (!organizerInteractionActive) {
		if (foldersChanged) renderFolders();
		else if (notesChanged) renderNotes();
	}
	if (activeNote()?.persisted) stateText.textContent = savedStateText();
	renderVersion();
	fitEditor();
	return true;
}

function requestRemoteRefresh() {
	void refreshNotebookFromServer();
}

function showCleaning() {
	clearTimeout(stateTimer);
	state.classList.remove('saved');
	stateText.textContent = 'Cleaning thought locally…';
}

async function cleanSubmittedThought(noteId: string, thoughtId: string, rawThought: string) {
	if (!agentSetup.agent || !agentSetup.automaticCleanupEnabled || !rawThought.trim()) return;
	showCleaning();
	try {
		const cleaned = await agentSetup.agent.cleanThought(rawThought);
		const note = notes.find((candidate) => candidate.id === noteId);
		if (!note) return;
		const update = applyThoughtCleanup(note.savedText, note.thoughts, thoughtId, cleaned);
		const savedSegment = note.savedText.slice(update.start, update.end);
		note.savedText = update.text;
		note.thoughts = update.thoughts;
		const currentDraft = drafts.get(note.id) ?? note.savedText;
		if (currentDraft.slice(update.start, update.end) === savedSegment) {
			const updatedDraft = `${currentDraft.slice(0, update.start)}${update.replacement}${currentDraft.slice(update.end)}`;
			drafts.set(note.id, updatedDraft);
			if (updatedDraft === update.text) await store.clearDraft(note.id);
			else await store.saveDraft(note.id, updatedDraft, note.location);
			if (activeNoteId === note.id) editor.value = updatedDraft;
		}
		await store.commitNote({
			id: note.id,
			title: note.title,
			text: note.savedText,
			finalText: note.finalText,
			thoughts: note.thoughts,
			location: note.location
		});
		serverDurable = await synchronizeNotebook();
		renderNotes();
		fitEditor();
		state.classList.add('saved');
		stateText.textContent = serverDurable
			? 'Thought cleaned and saved to server'
			: 'Thought cleaned offline — pending sync';
	} catch {
		state.classList.remove('saved');
		stateText.textContent = 'Cleanup failed — original kept';
	}
}

const agentSetup = new AgentSetup({
	onStatus({ connected, voice }) {
		voiceNote.hidden = !(connected && voice && 'MediaRecorder' in window && navigator.mediaDevices?.getUserMedia);
	},
	onOpen() {
		const note = activeNote();
		if (note) drafts.set(note.id, editor.value);
		workspace.hidden = true;
		setupPage.hidden = false;
		document.body.classList.remove('sidebar-open');
	},
	onClose() {
		setupPage.hidden = true;
		workspace.hidden = false;
		fitEditor();
		editor.focus();
	}
});

if (!notes.length) createNewNote();
else {
	editor.value = currentText(notes[0]!);
	stateText.textContent = savedStateText();
}
renderVersion();
renderFolders();
openMarkdown.hidden = !supportsLocalMarkdownFiles();
renderLocalFiles();

function commitEditor() {
	const note = activeNote();
	if (activeLocal) {
		const local = activeLocal;
		const submittedText = editor.value.endsWith('\n') ? editor.value : `${editor.value}\n`;
		editor.value = submittedText;
		editor.disabled = true;
		state.classList.remove('saved');
		stateText.textContent = agentSetup.agent && agentSetup.automaticCleanupEnabled
			? 'Correcting before saving to file…'
			: 'Saving to local file…';
		void local.document.commit(
			submittedText,
			agentSetup.agent && agentSetup.automaticCleanupEnabled
				? (thought) => agentSetup.agent!.cleanThought(thought)
				: undefined
		).then((result) => {
			editor.value = result.text;
			local.binding.text = result.text;
			local.binding.recoveryText = null;
			state.classList.add('saved');
			stateText.textContent = result.cleanup === 'failed'
				? 'Cleanup failed — original saved to local file'
				: 'Saved to local file';
		}).catch((error) => {
			local.binding.recoveryText = submittedText;
			state.classList.remove('saved');
			stateText.textContent = error instanceof LocalMarkdownConflictError
				? 'File changed elsewhere — local edit preserved'
				: error instanceof LocalFilePermissionError
				? 'Permission needed — local edit preserved'
				: 'File save failed — local edit preserved';
		}).finally(() => {
			editor.disabled = false;
			fitEditor();
			editor.focus();
		});
		return;
	}
	if (!note) return;
	const submittedText = editor.value.endsWith('\n') ? editor.value : `${editor.value}\n`;
	editor.value = submittedText;
	drafts.set(note.id, submittedText);
	fitEditor();
	void (async () => {
		await store.saveDraft(note.id, submittedText, note.location);
		const thoughtId = `thought-${crypto.randomUUID()}`;
		const submitted = appendThought(note.savedText, note.thoughts, submittedText, thoughtId);
		note.savedText = submittedText;
		note.thoughts = submitted.thoughts;
		await store.commitNote({
			id: note.id,
			title: note.title,
			text: note.savedText,
			finalText: note.finalText,
			thoughts: note.thoughts,
			location: note.location
		});
		await store.clearDraft(note.id, submittedText);
		note.persisted = true;
		renderNotes();
		serverDurable = await synchronizeNotebook();
		showSaved(serverDurable);
		fitEditor();
		if (submitted.appended) void cleanSubmittedThought(note.id, thoughtId, submitted.rawThought);
	})();
}

editor.addEventListener('keydown', (event) => {
	if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
	event.preventDefault();
	commitEditor();
});

saveThought.addEventListener('click', commitEditor);
noteTitleDisplay.addEventListener('change', () => {
	const note = activeNote();
	if (!note || activeLocal) return;
	note.title = noteTitleDisplay.value.trim() || 'Untitled note';
	renderNotes();
	if (!note.persisted) return;
	void (async () => {
		await store.commitNote({
			id: note.id,
			title: note.title,
			text: note.savedText,
			finalText: note.finalText,
			thoughts: note.thoughts,
			location: note.location
		});
		serverDurable = await synchronizeNotebook();
		showSaved(serverDurable);
	})();
});
noteTitleDisplay.addEventListener('keydown', (event) => {
	if (event.key !== 'Enter') return;
	event.preventDefault();
	noteTitleDisplay.blur();
});
showRawVersion.addEventListener('click', () => showVersion(false));
showFinalVersion.addEventListener('click', () => showVersion(true));

function resetVoiceDialog() {
	voiceSegments = [];
	voiceRecorder = undefined;
	voiceStatus.textContent = 'Ready to record.';
	startVoice.hidden = false;
	startVoice.disabled = false;
	stopVoice.hidden = true;
	transcribeVoice.hidden = true;
	transcribeVoice.disabled = false;
}

voiceNote.addEventListener('click', () => {
	if (activeLocal) return;
	resetVoiceDialog();
	voiceDialog.showModal();
});
startVoice.addEventListener('click', () => {
	startVoice.disabled = true;
	voiceStatus.textContent = 'Requesting microphone access…';
	const recorder = new VoiceRecorder();
	voiceRecorder = recorder;
	void recorder.start().then(() => {
		voiceStatus.textContent = 'Recording…';
		startVoice.hidden = true;
		stopVoice.hidden = false;
	}).catch(() => {
		voiceStatus.textContent = 'Microphone access was not available.';
		startVoice.disabled = false;
	});
});
stopVoice.addEventListener('click', () => {
	stopVoice.disabled = true;
	void voiceRecorder?.stop().then((segments) => {
		voiceSegments = segments;
		voiceStatus.textContent = segments.length
			? 'Recording ready on this device.'
			: 'No audio was recorded.';
		stopVoice.hidden = true;
		stopVoice.disabled = false;
		transcribeVoice.hidden = segments.length === 0;
	});
});
transcribeVoice.addEventListener('click', () => {
	const agent = agentSetup.agent;
	if (!agent || !voiceSegments.length) return;
	transcribeVoice.disabled = true;
	voiceStatus.textContent = `Transcribing 1 of ${voiceSegments.length}…`;
	void (async () => {
		try {
			const transcripts: string[] = [];
			for (const [index, segment] of voiceSegments.entries()) {
				voiceStatus.textContent = `Transcribing ${index + 1} of ${voiceSegments.length}…`;
				transcripts.push(await agent.transcribe(segment));
			}
			if (viewingFinal) showVersion(false);
			const note = activeNote();
			if (!note) return;
			const transcript = transcripts.join('\n\n');
			const existing = editor.value.trimEnd();
			const updated = existing ? `${existing}\n\n${transcript}\n` : `${transcript}\n`;
			editor.value = updated;
			drafts.set(note.id, updated);
			await store.saveDraft(note.id, updated, note.location);
			voiceSegments = [];
			voiceRecorder = undefined;
			voiceDialog.close();
			state.classList.remove('saved');
			stateText.textContent = 'Voice transcript ready — review and save';
			renderNoteTitle();
			fitEditor();
		} catch (error) {
			voiceStatus.textContent = error instanceof Error ? error.message : 'Transcription failed — recording kept on this device.';
			transcribeVoice.disabled = false;
		}
	})();
});
closeVoice.addEventListener('click', () => {
	const recorder = voiceRecorder;
	voiceRecorder = undefined;
	void recorder?.stop();
	voiceSegments = [];
	voiceDialog.close();
	voiceNote.focus();
});

exportNoteMarkdown.addEventListener('click', () => {
	downloadNote(editor.value, displayedNoteTitle(), 'md');
});
exportNoteText.addEventListener('click', () => {
	downloadNote(editor.value, displayedNoteTitle(), 'txt');
});

function closeDistillation() {
	distillDialog.close();
	distillNote.focus();
}

distillNote.addEventListener('click', () => {
	if (activeLocal) return;
	const sourceTitle = displayedNoteTitle();
	distilledMarkdown = '';
	distilledSourceTitle = sourceTitle;
	distillDialogTitle.textContent = `Distilled ${sourceTitle}`;
	distillStatus.textContent = 'Choose your options, then organize the note.';
	distillResult.textContent = '';
	distillResult.hidden = true;
	includeDistillSummary.checked = false;
	includeDistillSummary.disabled = false;
	runDistillation.hidden = false;
	runDistillation.disabled = false;
	saveDistilledNote.hidden = true;
	saveDistilledNote.disabled = true;
	exportDistilledMarkdown.disabled = true;
	exportDistilledText.disabled = true;
	distillDialog.showModal();
});
runDistillation.addEventListener('click', () => {
	const source = editor.value;
	includeDistillSummary.disabled = true;
	runDistillation.disabled = true;
	distillStatus.textContent = 'Organizing note…';
	void new LocalAgent().distillNote(source, includeDistillSummary.checked).then((result) => {
		distilledMarkdown = result;
		distillStatus.textContent = 'Distillation ready';
		distillResult.textContent = result;
		distillResult.hidden = false;
		runDistillation.hidden = true;
		saveDistilledNote.hidden = false;
		saveDistilledNote.disabled = false;
		exportDistilledMarkdown.disabled = false;
		exportDistilledText.disabled = false;
	}).catch((error) => {
		distillStatus.textContent = error instanceof Error ? error.message : 'The note could not be distilled.';
		includeDistillSummary.disabled = false;
		runDistillation.disabled = false;
	});
});
closeDistill.addEventListener('click', closeDistillation);
saveDistilledNote.addEventListener('click', () => {
	if (!distilledMarkdown) return;
	const note = activeNote();
	if (!note) return;
	note.finalText = distilledMarkdown;
	void (async () => {
		await store.commitNote({
			id: note.id,
			title: note.title,
			text: note.savedText,
			finalText: note.finalText,
			thoughts: note.thoughts,
			location: note.location
		});
		serverDurable = await synchronizeNotebook();
		distillDialog.close();
		showVersion(true);
		stateText.textContent = serverDurable
			? 'Final version saved to server'
			: 'Final version saved offline — pending sync';
	})();
});
exportDistilledMarkdown.addEventListener('click', () => {
	if (distilledMarkdown) downloadNote(distilledMarkdown, `${distilledSourceTitle} distilled`, 'md');
});
exportDistilledText.addEventListener('click', () => {
	if (distilledMarkdown) downloadNote(distilledMarkdown, `${distilledSourceTitle} distilled`, 'txt');
});

editor.addEventListener('input', () => {
	if (activeLocal) {
		activeLocal.binding.recoveryText = editor.value;
		void localMarkdownStore.saveRecovery(activeLocal.binding.id, editor.value);
		renderNoteTitle();
		renderLocalFiles();
		fitEditor();
		return;
	}
	const note = activeNote();
	if (note) {
		drafts.set(note.id, editor.value);
		void store.saveDraft(note.id, editor.value, note.location);
	}
	renderNotes();
	fitEditor();
});

newNote.addEventListener('click', createNewNote);
openMarkdown.addEventListener('click', () => {
	document.body.classList.remove('sidebar-open');
	void openLocalMarkdown();
});
cancelDelete.addEventListener('click', closeDeleteDialog);
confirmDelete.addEventListener('click', () => {
	const noteId = pendingDeleteNoteId;
	deleteDialog.close();
	pendingDeleteNoteId = undefined;
	deleteReturnFocus = undefined;
	if (noteId) deleteNote(noteId);
});
deleteDialog.addEventListener('cancel', (event) => {
	event.preventDefault();
	closeDeleteDialog();
});
addRootFolder.addEventListener('click', () => {
	creatingParentId = null;
	renamingFolderId = undefined;
	renderFolders();
});
sidebarToggle.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
attachLocationBehavior(requireElement<HTMLButtonElement>('[data-location="scratchpad"]'));
document.addEventListener('click', () => closeMoveMenus());
document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape') closeMoveMenus();
});
window.addEventListener('resize', fitEditor);
window.addEventListener('online', requestRemoteRefresh);
let refreshAfterWindowFocus = false;
window.addEventListener('blur', () => {
	refreshAfterWindowFocus = true;
});
window.addEventListener('focus', () => {
	if (!refreshAfterWindowFocus) return;
	refreshAfterWindowFocus = false;
	window.setTimeout(requestRemoteRefresh, 0);
});
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible') requestRemoteRefresh();
});
window.setInterval(requestRemoteRefresh, 30_000);
editor.disabled = false;
document.documentElement.dataset.notebookReady = 'true';
fitEditor();
}
