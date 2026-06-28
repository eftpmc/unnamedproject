import { test, expect } from '@playwright/test';
import { createChat, deleteChat } from './helpers.js';

test.describe('chats page', () => {
  let chatId: string;

  test.beforeAll(async ({ request }) => {
    chatId = await createChat(request, 'Playwright test chat');
  });

  test.afterAll(async ({ request }) => {
    await deleteChat(request, chatId);
  });

  test('chats page loads with list', async ({ page }) => {
    await page.goto('/chats');
    await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
    await expect(page.locator('[data-slot="data-table-row"]').first()).toBeVisible();
  });

  test('chat row has options menu with rename and delete', async ({ page }) => {
    await page.goto('/chats');
    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    await expect(firstRow).toBeVisible();

    await firstRow.getByRole('button', { name: /options/i }).click();

    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  });

  test('rename inline input appears and focuses', async ({ page }) => {
    await page.goto('/chats');
    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    await expect(firstRow).toBeVisible();

    await firstRow.getByRole('button', { name: /options/i }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();

    const renameInput = firstRow.locator('input');
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(renameInput).not.toBeVisible();
  });

  test('delete shows confirm dialog and cancel works', async ({ page }) => {
    await page.goto('/chats');
    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    await expect(firstRow).toBeVisible();

    await firstRow.getByRole('button', { name: /options/i }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    await expect(page.getByText('Delete chat?')).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText('Delete chat?')).not.toBeVisible();
  });

  test('new chat button navigates to new chat', async ({ page }) => {
    await page.goto('/chats');
    await page.getByRole('button', { name: 'New chat' }).click();
    await expect(page.getByPlaceholder('What can I help with?')).toBeVisible();
  });
});
