import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

const capability = 'aegirtech.dev/cap/agenticscribe';

function testOwner(testInfo: TestInfo) {
	const identity = `${testInfo.project.name}-${testInfo.title}`
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-|-$/g, '')
		.slice(0, 180);
	return `playwright-${identity}@example.test`;
}

function tailscaleHeaders(owner: string) {
	return {
		'Tailscale-User-Login': owner,
		'Tailscale-App-Capabilities': JSON.stringify({
			[capability]: [{ role: 'owner' }]
		})
	};
}

async function openOrganizer(page: Page) {
	const toggle = page.getByRole('button', { name: 'Open folders' });
	const alreadyOpen = await page.locator('body').evaluate((body) => body.classList.contains('sidebar-open'));
	if (!alreadyOpen && await toggle.isVisible()) await toggle.click();
}

async function saveThought(page: Page, text: string, title?: string) {
	if (title) {
		await page.getByRole('textbox', { name: 'Note title' }).fill(title);
		await page.getByRole('textbox', { name: 'Note title' }).press('Enter');
	}
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await editor.click();
	await editor.pressSequentially(text);
	await expectEditorMarkdown(page, `${text}\n`);
	await editor.press('Enter');
	await expect(page.getByRole('status')).toContainText('Thought saved to server');
}

async function expectEditorMarkdown(page: Page, markdown: string) {
	await expect(page.locator('#editor')).toHaveAttribute('data-markdown', markdown);
}

async function replaceEditorText(editor: Locator, text: string) {
	await editor.click();
	await editor.press('Control+A');
	await editor.pressSequentially(text);
}

test.beforeEach(async ({ page }, testInfo) => {
	await page.setExtraHTTPHeaders(tailscaleHeaders(testOwner(testInfo)));
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('data-notebook-ready', 'true');
});

test('the notebook exposes discoverable Markdown formatting controls', async ({ page }) => {
	await expect(page.locator('html')).toHaveAttribute('data-notebook-ready', 'true');
	await expect(page.getByRole('button', { name: 'Bold' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Bullet list' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Link' })).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Continuous note' })).toBeEditable();
});

test('Enter activates Markdown toolbar controls without saving the note', async ({ page }) => {
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await replaceEditorText(editor, 'Keyboard formatting');
	await editor.press('ControlOrMeta+A');
	const bold = page.getByRole('button', { name: 'Bold' });
	await bold.focus();

	await bold.press('Enter');

	await expect(editor.locator('strong')).toHaveText('Keyboard formatting');
	await expectEditorMarkdown(page, '**Keyboard formatting**\n');
	await expect(page.getByRole('status')).toContainText('Nothing saved yet');
});

test('Space and Enter operate the Markdown heading selector without saving', async ({ page }) => {
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await replaceEditorText(editor, 'Keyboard heading');
	await editor.press('ControlOrMeta+A');
	const headingSelector = page.locator('.top-bar-heading-button');
	await headingSelector.focus();

	await headingSelector.press(' ');
	const headingOne = page.getByRole('button', { name: 'Heading 1', exact: true });
	await expect(headingOne).toBeVisible();
	await headingOne.focus();
	await headingOne.press('Enter');

	await expect(editor.getByRole('heading', { level: 1, name: 'Keyboard heading' })).toBeVisible();
	await expectEditorMarkdown(page, '# Keyboard heading\n');
	await expect(page.getByRole('status')).toContainText('Nothing saved yet');
});

test('dark mode is labeled and persists across reloads', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await openOrganizer(page);
	const darkMode = page.getByRole('switch', { name: 'Use dark mode' });
	await expect(darkMode).toBeVisible();
	await expect(darkMode).toHaveAttribute('aria-checked', 'false');
	await expect(darkMode).not.toContainText('Dark mode');

	await darkMode.click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(page.getByRole('switch', { name: 'Use light mode' })).toHaveAttribute('aria-checked', 'true');

	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await openOrganizer(page);
	await expect(page.getByRole('switch', { name: 'Use light mode' })).toBeVisible();
});

test('the note title is edited independently from Markdown content', async ({ page }) => {
	const title = page.getByRole('textbox', { name: 'Note title' });
	await expect(title).toHaveValue('Untitled note');
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await editor.click();
	await editor.pressSequentially('# ');
	await editor.pressSequentially('Quarterly planning');

	await expect(title).toHaveValue('Untitled note');
	await title.fill('Q3 priorities');
	await title.press('Enter');
	await expectEditorMarkdown(page, '# Quarterly planning\n');
	await expect(title).toHaveValue('Q3 priorities');
	await page.getByRole('button', { name: 'Save thought' }).click();
	await expect(page.getByRole('status')).toContainText('Thought saved to server');

	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Q3 priorities');
	await expectEditorMarkdown(page, '# Quarterly planning\n');
});
test('Enter saves the current thought', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await replaceEditorText(editor, 'First thought');

	await editor.press('Enter');

	await expect(page.getByRole('status')).toContainText('Thought saved to server');
	await expectEditorMarkdown(page, 'First thought\n\n');
});

test('a repeated Enter keydown does not submit another save', async ({ page }) => {
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await replaceEditorText(editor, 'One submission');

	await editor.evaluate((element) => {
		element.dispatchEvent(new KeyboardEvent('keydown', {
			key: 'Enter',
			bubbles: true,
			cancelable: true,
			repeat: true
		}));
	});
	await page.waitForTimeout(300);

	await expect(page.getByRole('status')).toContainText('Nothing saved yet');
});

test('Enter activates editor mode controls without saving the note', async ({ page }) => {
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await replaceEditorText(editor, 'Unfinished thought');
	const markdownMode = page.getByRole('button', { name: 'Markdown', exact: true });
	await markdownMode.focus();

	await markdownMode.press('Enter');

	await expect(page.getByRole('textbox', { name: 'Raw Markdown' })).toBeVisible();
	await expect(page.getByRole('status')).toContainText('Nothing saved yet');
});

test('Enter used to confirm IME composition does not save the note', async ({ page }) => {
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await replaceEditorText(editor, 'Composing thought');

	await editor.evaluate((element) => {
		const event = new KeyboardEvent('keydown', {
			key: 'Enter',
			bubbles: true,
			cancelable: true,
			composed: true
		});
		Object.defineProperty(event, 'isComposing', { value: true });
		element.dispatchEvent(event);
	});
	await page.waitForTimeout(300);

	await expect(page.getByRole('status')).toContainText('Nothing saved yet');
});

test('Shift+Enter creates a line break without saving the note', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await editor.click();
	await editor.pressSequentially('First line');
	await editor.press('Shift+Enter');
	await editor.pressSequentially('Second line');

	await expect(editor.locator('br')).toHaveCount(1);
	await expect(page.getByRole('status')).toContainText('Nothing saved yet');
	await page.getByRole('button', { name: 'Save thought' }).click();
	await expect(page.getByRole('status')).toContainText('Thought saved to server');
});

test('Markdown shortcuts render as formatted content while typing', async ({ page }) => {
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await editor.click();
	await editor.pressSequentially('# ');
	await editor.pressSequentially('Rendered heading');

	await expect(editor.getByRole('heading', { level: 1, name: 'Rendered heading' })).toBeVisible();
});

test('raw Markdown mode round-trips source edits back into the visual editor', async ({ page }) => {
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await editor.click();
	await editor.pressSequentially('Visual heading');
	await expectEditorMarkdown(page, 'Visual heading\n');

	await page.getByRole('button', { name: 'Markdown', exact: true }).click();
	const source = page.getByRole('textbox', { name: 'Raw Markdown' });
	await expect(source).toBeVisible();
	await expect(source).toHaveValue('Visual heading\n');
	await source.fill('## Edited in Markdown\n\n**Still portable.**\n');

	await page.getByRole('button', { name: 'Visual' }).click();
	await expect(editor.getByRole('heading', { level: 2, name: 'Edited in Markdown' })).toBeVisible();
	await expect(editor.locator('strong')).toHaveText('Still portable.');
	await expectEditorMarkdown(page, '## Edited in Markdown\n\n**Still portable.**\n');
});

test('offers the browser install prompt without making the user hunt for it', async ({ page }) => {
	await expect(page.locator('html')).toHaveAttribute('data-notebook-ready', 'true');
	await page.evaluate(() => {
		const installEvent = new Event('beforeinstallprompt', { cancelable: true });
		Object.defineProperty(installEvent, 'prompt', {
			value: () => {
				(window as Window & { installPromptCalled?: boolean }).installPromptCalled = true;
				return Promise.resolve({ outcome: 'accepted' });
			}
		});
		window.dispatchEvent(installEvent);
	});

	await openOrganizer(page);
	await expect(page.getByRole('heading', { name: 'Install AgenticScribe' })).toBeVisible();
	await page.getByRole('button', { name: 'Install app' }).click();
	await expect.poll(() => page.evaluate(() =>
		Boolean((window as Window & { installPromptCalled?: boolean }).installPromptCalled)
	)).toBe(true);
	await expect(page.getByRole('heading', { name: 'Install AgenticScribe' })).toHaveCount(0);
});

test('the installed application shell reloads while offline', async ({ browser }, testInfo) => {
	const context = await browser.newContext({
		serviceWorkers: 'allow',
		extraHTTPHeaders: tailscaleHeaders(testOwner(testInfo))
	});
	try {
		const page = await context.newPage();
		await page.goto('http://127.0.0.1:4173/');
		await page.evaluate(async () => {
			await navigator.serviceWorker.ready;
		});
		await page.reload();
		await context.setOffline(true);
		await page.reload();
		await expect(page.getByRole('textbox', { name: 'Continuous note' })).toBeEnabled();
		const protectedResults = await page.evaluate(async () => {
			return Promise.all(['/api/notebook/snapshot', '/auth/login'].map(async (path) => {
				try {
					await fetch(path);
					return 'unexpected-response';
				} catch {
					return 'network-only';
				}
			}));
		});
		expect(protectedResults).toEqual(['network-only', 'network-only']);
	} finally {
		await context.close();
	}
});

test('a committed note survives loss of the original browser profile', async ({ browser, page }, testInfo) => {
	await saveThought(page, 'Stored on nanobot');
	await expect(page.getByRole('status')).toContainText('Saved to server');

	const replacementProfile = await browser.newContext({
		extraHTTPHeaders: tailscaleHeaders(testOwner(testInfo))
	});
	try {
		const replacementPage = await replacementProfile.newPage();
		await replacementPage.goto('http://127.0.0.1:4173/');
		await expectEditorMarkdown(replacementPage, 'Stored on nanobot\n');
	} finally {
		await replacementProfile.close();
	}
});

test('an offline commit syncs after reconnect and survives a new browser profile', async ({
	browser,
	context,
	page
}, testInfo) => {
	await context.setOffline(true);
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await replaceEditorText(editor, 'Written without a connection');
	await expectEditorMarkdown(page, 'Written without a connection\n');
	await editor.press('Enter');
	await expect(page.getByRole('status')).toContainText('Thought saved offline — pending sync');

	await context.setOffline(false);
	await page.evaluate(() => window.dispatchEvent(new Event('online')));
	await expect(page.getByRole('status')).toContainText('Saved to server');

	const replacementProfile = await browser.newContext({
		extraHTTPHeaders: tailscaleHeaders(testOwner(testInfo))
	});
	try {
		const replacementPage = await replacementProfile.newPage();
		await replacementPage.goto('http://127.0.0.1:4173/');
		await expectEditorMarkdown(replacementPage, 'Written without a connection\n');
	} finally {
		await replacementProfile.close();
	}
});

test('an already-open device refreshes notes when it regains focus', async ({ browser, page }, testInfo) => {
	const owner = testOwner(testInfo);
	const otherDevice = await browser.newContext({ extraHTTPHeaders: tailscaleHeaders(owner) });
	try {
		const otherPage = await otherDevice.newPage();
		await otherPage.goto('http://127.0.0.1:4173/');
		await expect(otherPage.locator('html')).toHaveAttribute('data-notebook-ready', 'true');
		const otherEditor = otherPage.getByRole('textbox', { name: 'Continuous note' });
		await otherEditor.click();
		await otherEditor.pressSequentially('Unfinished on the second device');

		await saveThought(page, 'Written on the first device', 'Written on the first device');
		await otherPage.evaluate(() => window.dispatchEvent(new Event('blur')));
		await otherPage.bringToFront();
		await otherPage.evaluate(() => window.dispatchEvent(new Event('focus')));

		await openOrganizer(otherPage);
		await expect(otherPage.getByRole('button', { name: 'Written on the first device', exact: true })).toBeVisible();
		await expectEditorMarkdown(otherPage, 'Unfinished on the second device\n');
	} finally {
		await otherDevice.close();
	}
});

test('an open device periodically checks for remote notebook changes', async ({ page }) => {
	await page.clock.install();
	let snapshotRequests = 0;
	await page.route('**/api/notebook/snapshot', async (route) => {
		snapshotRequests += 1;
		await route.continue();
	});
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-notebook-ready', 'true');
	const requestsAfterStartup = snapshotRequests;

	await page.clock.fastForward(30_000);

	await expect.poll(() => snapshotRequests).toBeGreaterThan(requestsAfterStartup);
});

test('deployment-managed agent setup is reachable without browser-owned connection fields', async ({
	page
}) => {
	await saveThought(page, 'Keep this note');
	await openOrganizer(page);
	await page.getByRole('button', { name: 'Agent setup' }).click();

	await expect(page.getByRole('heading', { name: 'Use your deployment agent' })).toBeVisible();
	await expect(page.getByLabel('Base URL')).toHaveCount(0);
	await expect(page.getByLabel('Model')).toHaveCount(0);
	await expect(page.getByText('Connection and model routing are managed by this deployment.')).toBeVisible();
	await expect(page.getByText('Not connected', { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Back to notes' }).click();
	await expectEditorMarkdown(page, 'Keep this note\n\n');
});

test('a distillation is saved as the final version of its raw note and survives reload', async ({ page }) => {
	const source = 'Project update\n\nDecision: ship the modal';
	const distilled = '# Summary\n\nThe project is ready.\n\n## Action items\n\n- Ship the modal';
	await page.route('**/api/agent/distill', async (route) => {
		expect(route.request().postDataJSON()).toEqual({ note: `${source}\n`, includeSummary: false });
		await route.fulfill({ json: { distilledNote: distilled } });
	});
	await page.getByRole('button', { name: 'Markdown', exact: true }).click();
	await page.getByRole('textbox', { name: 'Raw Markdown' }).fill(`${source}\n`);
	await page.getByRole('button', { name: 'Visual' }).click();
	await expectEditorMarkdown(page, `${source}\n`);
	await page.getByRole('textbox', { name: 'Note title' }).fill('Project update');
	await page.getByRole('textbox', { name: 'Note title' }).press('Enter');
	await page.getByRole('button', { name: 'Save thought' }).click();
	await expect(page.getByRole('status')).toContainText('Thought saved to server');

	const markdownDownload = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export note as Markdown' }).click();
	await expect((await markdownDownload).suggestedFilename()).toBe('Project-update.md');

	await page.getByRole('button', { name: 'Distill note' }).click();
	const dialog = page.getByRole('dialog', { name: 'Distilled Project update' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('The entire current note is sent to your deployment-managed agent.')).toBeVisible();
	await expect(dialog.getByRole('checkbox', { name: 'Include summary' })).not.toBeChecked();
	await dialog.getByRole('button', { name: 'Organize note' }).click();
	await expect(dialog.getByText('The project is ready.')).toBeVisible();
	await expectEditorMarkdown(page, `${source}\n`);

	const textDownload = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export distilled text' }).click();
	await expect((await textDownload).suggestedFilename()).toBe('Project-update-distilled.txt');

	await dialog.getByRole('button', { name: 'Use as final version' }).click();
	await expect(dialog).not.toBeVisible();
	await expectEditorMarkdown(page, `${distilled}\n`);
	await expect(page.getByRole('button', { name: 'Final version', pressed: true })).toBeVisible();
	await page.getByRole('button', { name: 'Raw version' }).click();
	await expectEditorMarkdown(page, `${source}\n`);
	await page.reload();
	await page.getByRole('button', { name: 'Final version' }).click();
	await expectEditorMarkdown(page, `${distilled}\n`);
	await openOrganizer(page);
	await expect(page.getByRole('button', { name: 'Project update', exact: true })).toHaveCount(1);
});

test('a self-hosted voice recording becomes raw note text only after transcription succeeds', async ({ page }) => {
	await page.route('**/api/agent/status', (route) => route.fulfill({
		json: { configured: true, available: true, voice: true, model: 'deployment-model' }
	}));
	await page.route('**/api/agent/transcribe', async (route) => {
		expect(route.request().headers()['content-type']).toBe('audio/webm');
		expect(route.request().postDataBuffer()?.byteLength).toBeGreaterThan(0);
		await route.fulfill({ json: { transcript: 'Discuss the launch date with Morgan.' } });
	});
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'mediaDevices', {
			value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
			configurable: true
		});
		class FakeMediaRecorder {
			ondataavailable: ((event: { data: Blob }) => void) | null = null;
			onstop: (() => void) | null = null;
			start() {}
			stop() {
				this.ondataavailable?.({ data: new Blob(['synthetic voice'], { type: 'audio/webm' }) });
				this.onstop?.();
			}
		}
		Object.defineProperty(window, 'MediaRecorder', { value: FakeMediaRecorder, configurable: true });
	});
	await page.reload();
	await expect(page.getByRole('button', { name: 'Record voice note' })).toBeVisible();

	await page.getByRole('button', { name: 'Record voice note' }).click();
	const dialog = page.getByRole('dialog', { name: 'Voice note' });
	await dialog.getByRole('button', { name: 'Start recording' }).click();
	await expect(dialog.getByText('Recording…')).toBeVisible();
	await dialog.getByRole('button', { name: 'Stop recording' }).click();
	await expect(dialog.getByText('Recording ready on this device')).toBeVisible();
	await dialog.getByRole('button', { name: 'Transcribe recording' }).click();

	await expect(dialog).not.toBeVisible();
	await expectEditorMarkdown(page, 'Discuss the launch date with Morgan.\n');
	await expect(page.getByRole('status')).toContainText('Voice transcript ready — review and save');
});

test('connecting the local agent cleans only a thought after it is saved', async ({ page }) => {
	let statusRequests = 0;
	await page.route('**/api/agent/status', async (route) => {
		statusRequests += 1;
		await route.fulfill({
			json: { configured: true, available: true, model: 'deployment-model' }
		});
	});
	let releaseCleanup!: () => void;
	const cleanupReleased = new Promise<void>((resolve) => {
		releaseCleanup = resolve;
	});
	let cleanupRequested!: () => void;
	const cleanupRequest = new Promise<void>((resolve) => {
		cleanupRequested = resolve;
	});
	await page.route('**/api/agent/cleanup', async (route) => {
		const requestBody = route.request().postDataJSON();
		expect(requestBody).toEqual({ thought: 'this thought have bad grammer.' });
		cleanupRequested();
		await cleanupReleased;
		await route.fulfill({ json: { cleanedThought: 'This thought has bad grammar.' } });
	});

	await openOrganizer(page);
	await page.getByRole('button', { name: 'Agent setup' }).click();
	await page.getByRole('button', { name: 'Test connection' }).click();
	await expect.poll(() => statusRequests).toBeGreaterThan(0);
	await expect(page.getByText('Connected', { exact: true })).toBeVisible();
	await expect(page.getByText('deployment-model', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Back to notes' }).click();

	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await replaceEditorText(editor, 'this thought have bad grammer.');
	await expectEditorMarkdown(page, 'this thought have bad grammer.\n');
	await editor.press('Enter');
	await cleanupRequest;
	await expectEditorMarkdown(page, 'this thought have bad grammer.\n\n');
	releaseCleanup();
	await expectEditorMarkdown(page, 'This thought has bad grammar.\n\n');
	await expect(page.getByRole('status')).toContainText('Thought cleaned and saved');

	await page.reload();
	await expectEditorMarkdown(page, 'This thought has bad grammar.\n\n');
});

test('a failed cleanup keeps the submitted thought unchanged', async ({ page }) => {
	await page.route('**/api/agent/status', async (route) => {
		await route.fulfill({
			json: { configured: true, available: true, model: 'deployment-model' }
		});
	});
	await page.route('**/api/agent/cleanup', async (route) => {
		await route.fulfill({
			status: 500,
			json: { error: 'synthetic failure' }
		});
	});

	await openOrganizer(page);
	await page.getByRole('button', { name: 'Agent setup' }).click();
	await page.getByRole('button', { name: 'Test connection' }).click();
	await expect(page.getByText('Connected', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Back to notes' }).click();

	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await replaceEditorText(editor, 'keep this raw thought');
	await expectEditorMarkdown(page, 'keep this raw thought\n');
	await editor.press('Enter');
	await expect(page.getByRole('status')).toContainText('Cleanup failed — original kept');
	await expectEditorMarkdown(page, 'keep this raw thought\n\n');

	await page.reload();
	await expectEditorMarkdown(page, 'keep this raw thought\n\n');
});

test('a local Markdown file writes locally without creating a notebook mutation', async ({ page }) => {
	let notebookMutations = 0;
	await page.route('**/api/notebook', async (route) => {
		if (route.request().method() === 'POST') notebookMutations += 1;
		await route.continue();
	});
	await page.addInitScript(() => {
		Object.defineProperty(window, 'showOpenFilePicker', {
			configurable: true,
			value: async () => {
				const root = await navigator.storage.getDirectory();
				const handle = await root.getFileHandle('local-notes.md', { create: true });
				const writable = await handle.createWritable();
				await writable.write('# Local notes\n');
				await writable.close();
				const permissionTarget = Object.getPrototypeOf(handle) as FileSystemFileHandle & {
					queryPermission?: () => Promise<PermissionState>;
					requestPermission?: () => Promise<PermissionState>;
				};
				permissionTarget.queryPermission = async () => 'granted';
				permissionTarget.requestPermission = async () => 'granted';
				return [handle];
			}
		});
	});
	await page.reload();

	await openOrganizer(page);
	await page.getByRole('button', { name: 'Open .md file' }).click();
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await expectEditorMarkdown(page, '# Local notes\n');
	await expect(page.getByRole('button', { name: 'Distill note' })).toBeDisabled();
	await expect(page.locator('body')).not.toHaveClass(/sidebar-open/);
	await editor.locator('p').last().click();
	await editor.pressSequentially('Saved only here');
	await expectEditorMarkdown(page, '# Local notes\n\nSaved only here\n');
	await editor.press('Enter');
	await expect(page.getByRole('status')).toContainText('Saved to local file');
	await expectEditorMarkdown(page, '# Local notes\n\nSaved only here\n\n');

	const fileText = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const handle = await root.getFileHandle('local-notes.md');
		return (await handle.getFile()).text();
	});
	expect(fileText).toBe('# Local notes\n\nSaved only here\n');
	expect(notebookMutations).toBe(0);
});

test('a failed local Markdown Enter-save preserves the new line as recovery', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(window, 'showOpenFilePicker', {
			configurable: true,
			value: async () => {
				const root = await navigator.storage.getDirectory();
				const handle = await root.getFileHandle('failing-local-notes.md', { create: true });
				const writable = await handle.createWritable();
				await writable.write('# Local notes\n');
				await writable.close();
				const permissionTarget = Object.getPrototypeOf(handle) as FileSystemFileHandle & {
					queryPermission?: () => Promise<PermissionState>;
					requestPermission?: () => Promise<PermissionState>;
				};
				permissionTarget.queryPermission = async () => 'granted';
				permissionTarget.requestPermission = async () => 'granted';
				Object.defineProperty(handle, 'createWritable', {
					configurable: true,
					value: async () => {
						throw new Error('synthetic write failure');
					}
				});
				return [handle];
			}
		});
	});
	await page.reload();

	await openOrganizer(page);
	await page.getByRole('button', { name: 'Open .md file' }).click();
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await editor.locator('p').last().click();
	await editor.pressSequentially('Keep recovery');
	await expectEditorMarkdown(page, '# Local notes\n\nKeep recovery\n');
	await editor.press('Enter');
	await expect(page.getByRole('status')).toContainText('File save failed — local edit preserved');
	await expectEditorMarkdown(page, '# Local notes\n\nKeep recovery\n\n');

	await openOrganizer(page);
	await page.locator('#notes-list .note-link').first().click();
	await expectEditorMarkdown(page, '');
	await openOrganizer(page);
	await page.getByRole('button', { name: 'failing-local-notes.md', exact: true }).click();
	await expectEditorMarkdown(page, '# Local notes\n\nKeep recovery\n\n');
});

test('explicit save commits a note and reload restores only committed text', async ({ page }) => {
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await replaceEditorText(editor, 'First saved thought');
	await expectEditorMarkdown(page, 'First saved thought\n');
	await page.getByRole('textbox', { name: 'Note title' }).fill('First saved thought');
	await page.getByRole('button', { name: 'Save thought' }).click();
	await expect(page.getByRole('status')).toContainText('Thought saved to server');
	await openOrganizer(page);
	await expect(page.getByRole('button', { name: 'First saved thought', exact: true })).toBeVisible();

	await page.reload();
	await expectEditorMarkdown(page, 'First saved thought\n');
});

test('the Save thought control stays visible while a long note scrolls', async ({ page }) => {
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await replaceEditorText(editor, Array.from({ length: 80 }, (_, index) => `Line ${index + 1}`).join('\n'));
	const saveThought = page.getByRole('button', { name: 'Save thought' });
	const viewport = page.viewportSize();
	const initialBox = await saveThought.boundingBox();

	expect(viewport).not.toBeNull();
	expect(initialBox).not.toBeNull();
	expect(initialBox!.y).toBeGreaterThanOrEqual(0);
	expect(initialBox!.y + initialBox!.height).toBeLessThanOrEqual(viewport!.height);

	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
	await expect.poll(async () => (await saveThought.boundingBox())?.y).toBe(initialBox!.y);
});

test('the Save thought status bar does not overlap a visible PWA update prompt', async ({ page }) => {
	await page.evaluate(() => {
		const prompt = document.createElement('aside');
		prompt.className = 'pwa-update-prompt';
		prompt.innerHTML = '<strong>AgenticScribe update ready</strong><span>A newer version is ready.</span><div><button>Update AgenticScribe</button><button>Later</button></div>';
		document.body.append(prompt);
	});

	const captureBox = await page.locator('.capture-state').boundingBox();
	const promptBox = await page.locator('.pwa-update-prompt').boundingBox();
	expect(captureBox).not.toBeNull();
	expect(promptBox).not.toBeNull();
	expect(promptBox!.y + promptBox!.height).toBeLessThanOrEqual(captureBox!.y);
});

test('the organizer stays pinned while a long note scrolls', async ({ page }) => {
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await replaceEditorText(editor, Array.from({ length: 80 }, (_, index) => `Line ${index + 1}`).join('\n'));
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

	const organizer = page.getByRole('complementary', { name: 'Notebook organization' });
	await expect.poll(async () => (await organizer.boundingBox())?.y).toBe(0);
});

test('switching and reload preserve an unfinished draft locally', async ({ page }) => {
	await saveThought(page, 'First note', 'First note');
	await openOrganizer(page);
	await expect(page.getByRole('button', { name: 'First note', exact: true })).toBeVisible();
	await page.getByRole('button', { name: '＋ New note' }).click();
	await openOrganizer(page);
	await expect(page.getByRole('button', { name: 'First note', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Untitled note unsaved', exact: true })).toBeVisible();
	await expectEditorMarkdown(page, '');
	await saveThought(page, 'Second note', 'Second note');

	await openOrganizer(page);
	await expect(page.getByRole('button', { name: 'Second note', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'First note', exact: true }).click();
	const firstNoteEditor = page.getByRole('textbox', { name: 'Continuous note' });
	await firstNoteEditor.locator('p').last().click();
	await firstNoteEditor.pressSequentially('unsaved tail');
	await expectEditorMarkdown(page, 'First note\n\nunsaved tail\n');
	await openOrganizer(page);
	await page.getByRole('button', { name: 'Second note', exact: true }).click();
	await openOrganizer(page);
	await page.getByRole('button', { name: 'First note', exact: true }).click();
	await expectEditorMarkdown(page, 'First note\n\nunsaved tail\n');

	await page.reload();
	await openOrganizer(page);
	await page.getByRole('button', { name: 'First note', exact: true }).click();
	await expectEditorMarkdown(page, 'First note\n\nunsaved tail\n');
});

test('a new note is created directly inside the selected folder', async ({ page }) => {
	await openOrganizer(page);
	await page.getByRole('button', { name: 'New folder', exact: true }).click();
	await page.getByRole('textbox', { name: 'Folder name' }).fill('Work');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await page.getByRole('button', { name: 'Work', exact: true }).click();
	await page.getByRole('button', { name: '＋ New note' }).click();
	await saveThought(page, 'Created in Work', 'Created in Work');

	await openOrganizer(page);
	await expect(page.getByRole('heading', { name: 'WORK NOTES' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Created in Work', exact: true })).toBeVisible();

	await page.reload();
	await openOrganizer(page);
	await page.getByRole('button', { name: 'Work', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Created in Work', exact: true })).toBeVisible();
});

test('nested folders can be renamed and a note can be moved into them', async ({ page }) => {
	await saveThought(page, 'Move this note', 'Move this note');
	await openOrganizer(page);
	await page.getByRole('button', { name: 'New folder', exact: true }).click();
	await page.getByRole('textbox', { name: 'Folder name' }).fill('Work');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await page.getByRole('button', { name: 'New folder inside Work' }).click();
	await page.getByRole('textbox', { name: 'Folder name' }).fill('Clients');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Rename Clients' })).toBeVisible();

	let refreshSnapshots = 0;
	await page.route('**/api/notebook/snapshot', async (route) => {
		refreshSnapshots += 1;
		await route.continue();
	});
	await page.getByRole('button', { name: 'Actions for Move this note' }).click();
	await page.evaluate(() => window.dispatchEvent(new Event('blur')));
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	await expect.poll(() => refreshSnapshots).toBeGreaterThanOrEqual(2);
	await page.getByRole('menuitem', { name: 'Clients', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'CLIENTS NOTES' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Move this note', exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Rename Clients' }).click();
	await page.getByRole('textbox', { name: 'Rename Clients' }).fill('Customers');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'CUSTOMERS NOTES' })).toBeVisible();

	await page.reload();
	await openOrganizer(page);
	await expect(page.getByRole('heading', { name: 'CUSTOMERS NOTES' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Move this note', exact: true })).toBeVisible();
});

test('deletion requires confirmation and deleting the final note leaves a blank draft', async ({ page }) => {
	await saveThought(page, 'Delete carefully', 'Delete carefully');
	await openOrganizer(page);
	await page.getByRole('button', { name: 'Actions for Delete carefully' }).click();
	await page.getByRole('menuitem', { name: 'Delete note' }).click();
	await expect(page.getByRole('heading', { name: 'Delete this note?' })).toBeVisible();
	await page.getByRole('button', { name: 'Keep note' }).click();
	await expect(page.getByRole('button', { name: 'Delete carefully', exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Actions for Delete carefully' }).click();
	await page.getByRole('menuitem', { name: 'Delete note' }).click();
	await page.getByRole('button', { name: 'Delete note' }).click();
	await expectEditorMarkdown(page, '');
	await openOrganizer(page);
	await expect(page.getByRole('button', { name: 'Untitled note unsaved', exact: true })).toBeVisible();

	await page.reload();
	await expectEditorMarkdown(page, '');
});
