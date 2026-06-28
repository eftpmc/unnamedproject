import { test, expect } from '@playwright/test';
import { createSpace, deleteSpace, createDocument } from './helpers.js';

test.describe('documents page', () => {
  let spaceId: string;

  test.beforeAll(async ({ request }) => {
    spaceId = await createSpace(request, 'Playwright test space');
    await createDocument(request, spaceId, 'Playwright test doc');
  });

  test.afterAll(async ({ request }) => {
    await deleteSpace(request, spaceId);
  });

  test('documents page loads', async ({ page }) => {
    await page.goto('/documents');
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
    await expect(page.locator('[data-slot="data-table-row"]').first()).toBeVisible();
  });

  test('document row has options menu with rename, copy path, and delete', async ({ page }) => {
    await page.goto('/documents');
    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    await expect(firstRow).toBeVisible();

    await firstRow.getByRole('button', { name: /options/i }).click();

    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Copy path' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  });

  test('rename inline input appears and dismisses on Escape', async ({ page }) => {
    await page.goto('/documents');
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

  test('delete option opens confirmation dialog', async ({ page }) => {
    await page.goto('/documents');
    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    await expect(firstRow).toBeVisible();

    await firstRow.getByRole('button', { name: /options/i }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    await expect(page.getByText('Delete document?')).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText('Delete document?')).not.toBeVisible();
  });
});
