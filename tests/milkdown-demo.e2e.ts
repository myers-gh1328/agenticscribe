import { expect, test } from '@playwright/test';

test('offers a discoverable markdown toolbar in an isolated demo', async ({ page }) => {
	await page.goto('/milkdown-demo.html');

	await expect(page.getByRole('heading', { name: 'Markdown, without the memorization.' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Bold' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Bullet list' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Link' })).toBeVisible();

	const editor = page.locator('.milkdown .editor');
	await expect(editor).toContainText('A calmer way to capture');
	await editor.click();
	await page.keyboard.type('Editable in the browser.');
	await expect(editor).toContainText('Editable in the browser.');
	await expect(page.getByText('Prototype only · nothing is saved')).toBeVisible();
});
