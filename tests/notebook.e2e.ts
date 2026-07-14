import { expect, test, type Page, type TestInfo } from '@playwright/test';

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

async function saveThought(page: Page, text: string) {
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await editor.fill(text);
	await editor.press('Enter');
	await expect(page.getByRole('status')).toContainText('Thought saved to server');
}

test.beforeEach(async ({ page }, testInfo) => {
	await page.setExtraHTTPHeaders(tailscaleHeaders(testOwner(testInfo)));
	await page.goto('/');
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
		await expect(replacementPage.getByRole('textbox', { name: 'Continuous note' })).toHaveValue(
			'Stored on nanobot\n'
		);
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
	await editor.fill('Written without a connection');
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
		await expect(replacementPage.getByRole('textbox', { name: 'Continuous note' })).toHaveValue(
			'Written without a connection\n'
		);
	} finally {
		await replacementProfile.close();
	}
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
	await expect(page.getByRole('textbox', { name: 'Continuous note' })).toHaveValue('Keep this note\n');
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
	await editor.fill('this thought have bad grammer.');
	await editor.press('Enter');
	await cleanupRequest;
	await expect(editor).toHaveValue('this thought have bad grammer.\n');
	releaseCleanup();
	await expect(editor).toHaveValue('This thought has bad grammar.\n');
	await expect(page.getByRole('status')).toContainText('Thought cleaned and saved');

	await page.reload();
	await expect(editor).toHaveValue('This thought has bad grammar.\n');
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
	await editor.fill('keep this raw thought');
	await editor.press('Enter');
	await expect(page.getByRole('status')).toContainText('Cleanup failed — original kept');
	await expect(editor).toHaveValue('keep this raw thought\n');

	await page.reload();
	await expect(editor).toHaveValue('keep this raw thought\n');
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
	await expect(editor).toHaveValue('# Local notes\n');
	await editor.press('End');
	await editor.type('Saved only here');
	await editor.press('Enter');
	await expect(page.getByRole('status')).toContainText('Saved to local file');

	const fileText = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const handle = await root.getFileHandle('local-notes.md');
		return (await handle.getFile()).text();
	});
	expect(fileText).toBe('# Local notes\nSaved only here\n');
	expect(notebookMutations).toBe(0);
});

test('Enter commits a note and reload restores only committed text', async ({ page }) => {
	await saveThought(page, 'First saved thought');
	await openOrganizer(page);
	await expect(page.getByRole('button', { name: 'First saved thought', exact: true })).toBeVisible();

	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Continuous note' })).toHaveValue(
		'First saved thought\n'
	);
});

test('the organizer stays pinned while a long note scrolls', async ({ page }) => {
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await editor.fill(Array.from({ length: 80 }, (_, index) => `Line ${index + 1}`).join('\n'));
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

	const organizer = page.getByRole('complementary', { name: 'Notebook organization' });
	await expect.poll(async () => (await organizer.boundingBox())?.y).toBe(0);
});

test('switching and reload preserve an unfinished draft locally', async ({ page }) => {
	await saveThought(page, 'First note');
	await openOrganizer(page);
	await expect(page.getByRole('button', { name: 'First note', exact: true })).toBeVisible();
	await page.getByRole('button', { name: '＋ New note' }).click();
	await openOrganizer(page);
	await expect(page.getByRole('button', { name: 'First note', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Untitled note unsaved', exact: true })).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Continuous note' })).toHaveValue('');
	await saveThought(page, 'Second note');

	await openOrganizer(page);
	await expect(page.getByRole('button', { name: 'Second note', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'First note', exact: true }).click();
	await page.getByRole('textbox', { name: 'Continuous note' }).press('End');
	await page.getByRole('textbox', { name: 'Continuous note' }).type(' unsaved tail');
	await openOrganizer(page);
	await page.getByRole('button', { name: 'Second note', exact: true }).click();
	await openOrganizer(page);
	await page.getByRole('button', { name: 'First note', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Continuous note' })).toHaveValue(
		'First note\n unsaved tail'
	);

	await page.reload();
	await openOrganizer(page);
	await page.getByRole('button', { name: 'First note', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Continuous note' })).toHaveValue(
		'First note\n unsaved tail'
	);
});

test('a new note is created directly inside the selected folder', async ({ page }) => {
	await openOrganizer(page);
	await page.getByRole('button', { name: 'New folder', exact: true }).click();
	await page.getByRole('textbox', { name: 'Folder name' }).fill('Work');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await page.getByRole('button', { name: 'Work', exact: true }).click();
	await page.getByRole('button', { name: '＋ New note' }).click();
	await saveThought(page, 'Created in Work');

	await openOrganizer(page);
	await expect(page.getByRole('heading', { name: 'WORK NOTES' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Created in Work', exact: true })).toBeVisible();

	await page.reload();
	await openOrganizer(page);
	await page.getByRole('button', { name: 'Work', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Created in Work', exact: true })).toBeVisible();
});

test('nested folders can be renamed and a note can be moved into them', async ({ page }) => {
	await saveThought(page, 'Move this note');
	await openOrganizer(page);
	await page.getByRole('button', { name: 'New folder', exact: true }).click();
	await page.getByRole('textbox', { name: 'Folder name' }).fill('Work');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await page.getByRole('button', { name: 'New folder inside Work' }).click();
	await page.getByRole('textbox', { name: 'Folder name' }).fill('Clients');
	await page.getByRole('button', { name: 'Save', exact: true }).click();

	await page.getByRole('button', { name: 'Actions for Move this note' }).click();
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
	await saveThought(page, 'Delete carefully');
	await openOrganizer(page);
	await page.getByRole('button', { name: 'Actions for Delete carefully' }).click();
	await page.getByRole('menuitem', { name: 'Delete note' }).click();
	await expect(page.getByRole('heading', { name: 'Delete this note?' })).toBeVisible();
	await page.getByRole('button', { name: 'Keep note' }).click();
	await expect(page.getByRole('button', { name: 'Delete carefully', exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Actions for Delete carefully' }).click();
	await page.getByRole('menuitem', { name: 'Delete note' }).click();
	await page.getByRole('button', { name: 'Delete note' }).click();
	await expect(page.getByRole('textbox', { name: 'Continuous note' })).toHaveValue('');
	await openOrganizer(page);
	await expect(page.getByRole('button', { name: 'Untitled note unsaved', exact: true })).toBeVisible();

	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Continuous note' })).toHaveValue('');
});
