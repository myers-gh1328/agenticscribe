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

test('local agent setup is reachable from the notebook and returns without changing notes', async ({
	page
}) => {
	await saveThought(page, 'Keep this note');
	await openOrganizer(page);
	await page.getByRole('button', { name: 'Agent setup' }).click();

	await expect(page.getByRole('heading', { name: 'Connect your local agent' })).toBeVisible();
	await expect(page.getByLabel('Base URL')).toHaveValue('http://192.168.4.43:8080/v1');
	await expect(page.getByLabel('Model')).toHaveValue('mlx-community/gemma-4-e4b-it-8bit');
	await expect(page.getByText('Not connected', { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Back to notes' }).click();
	await expect(page.getByRole('textbox', { name: 'Continuous note' })).toHaveValue('Keep this note\n');
});

test('connecting the local agent cleans only a thought after it is saved', async ({ page }) => {
	let modelRequests = 0;
	await page.route('**/v1/models', async (route) => {
		modelRequests += 1;
		if (route.request().method() === 'OPTIONS') {
			await route.fulfill({
				status: 204,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, OPTIONS',
					'Access-Control-Allow-Private-Network': 'true'
				}
			});
			return;
		}
		await route.fulfill({
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Private-Network': 'true'
			},
			json: { data: [{ id: 'mlx-community/gemma-4-e4b-it-8bit' }] }
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
	await page.route('**/v1/chat/completions', async (route) => {
		if (route.request().method() === 'OPTIONS') {
			await route.fulfill({
				status: 204,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Headers': 'Content-Type',
					'Access-Control-Allow-Methods': 'POST, OPTIONS',
					'Access-Control-Allow-Private-Network': 'true'
				}
			});
			return;
		}
		const requestBody = route.request().postDataJSON();
		expect(requestBody.messages.at(-1)).toEqual({
			role: 'user',
			content: 'this thought have bad grammer.'
		});
		cleanupRequested();
		await cleanupReleased;
		await route.fulfill({
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Private-Network': 'true'
			},
			json: { choices: [{ message: { content: 'This thought has bad grammar.' } }] }
		});
	});

	await openOrganizer(page);
	await page.getByRole('button', { name: 'Agent setup' }).click();
	await page.getByRole('button', { name: 'Save & connect' }).click();
	await expect.poll(() => modelRequests).toBeGreaterThan(0);
	await expect(page.getByText('Connected', { exact: true })).toBeVisible();
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
	await page.route('**/v1/models', async (route) => {
		await route.fulfill({
			headers: { 'Access-Control-Allow-Origin': '*' },
			json: { data: [{ id: 'mlx-community/gemma-4-e4b-it-8bit' }] }
		});
	});
	await page.route('**/v1/chat/completions', async (route) => {
		await route.fulfill({
			status: 500,
			headers: { 'Access-Control-Allow-Origin': '*' },
			json: { error: 'synthetic failure' }
		});
	});

	await openOrganizer(page);
	await page.getByRole('button', { name: 'Agent setup' }).click();
	await page.getByRole('button', { name: 'Save & connect' }).click();
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

test('switching preserves an unfinished draft in memory but reload discards it', async ({ page }) => {
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
	await expect(page.getByRole('textbox', { name: 'Continuous note' })).toHaveValue('First note\n');
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
