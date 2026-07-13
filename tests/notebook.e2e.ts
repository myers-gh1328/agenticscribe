import { expect, test, type Page } from '@playwright/test';

async function openOrganizer(page: Page) {
	const toggle = page.getByRole('button', { name: 'Open folders' });
	if (await toggle.isVisible()) await toggle.click();
}

async function saveThought(page: Page, text: string) {
	const editor = page.getByRole('textbox', { name: 'Continuous note' });
	await editor.fill(text);
	await editor.press('Enter');
	await expect(page.getByRole('status')).toContainText('Thought saved on this device');
}

test.beforeEach(async ({ page }) => {
	await page.goto('/');
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

test('Enter commits a note and reload restores only committed text', async ({ page }) => {
	await saveThought(page, 'First saved thought');
	await openOrganizer(page);
	await expect(page.getByRole('button', { name: 'First saved thought', exact: true })).toBeVisible();

	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Continuous note' })).toHaveValue(
		'First saved thought\n'
	);
});

test('switching preserves an unfinished draft in memory but reload discards it', async ({ page }) => {
	await saveThought(page, 'First note');
	await openOrganizer(page);
	await page.getByRole('button', { name: '＋ New note' }).click();
	await saveThought(page, 'Second note');

	await openOrganizer(page);
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
