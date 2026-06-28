import { test, expect } from '@playwright/test';

test.describe('media page', () => {
  test('media page loads', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByRole('heading', { name: 'Media' })).toBeVisible();
  });

  test('shows empty state or data table', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByRole('heading', { name: 'Media' })).toBeVisible();

    // Either the empty state or a data row must be visible
    const emptyState = page.getByText('No media yet');
    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    await expect(emptyState.or(firstRow)).toBeVisible();
  });

  test('search bar is visible when media exists', async ({ page }) => {
    await page.goto('/media');

    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    const hasData = await firstRow.isVisible().catch(() => false);
    if (!hasData) {
      test.skip(true, 'No media items to test with');
      return;
    }

    await expect(page.getByPlaceholder('Search media…')).toBeVisible();
  });

  test('filter strip is visible when media exists', async ({ page }) => {
    await page.goto('/media');

    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    const hasData = await firstRow.isVisible().catch(() => false);
    if (!hasData) {
      test.skip(true, 'No media items to test with');
      return;
    }

    await expect(page.getByRole('button', { name: 'All' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Images' })).toBeVisible();
  });

  test('options menu has download and delete when media exists', async ({ page }) => {
    await page.goto('/media');

    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    const hasData = await firstRow.isVisible().catch(() => false);
    if (!hasData) {
      test.skip(true, 'No media items to test with');
      return;
    }

    await firstRow.getByRole('button', { name: /options/i }).click();
    await expect(page.getByRole('menuitem', { name: 'Download' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  });

  test('delete shows confirm dialog and cancel works when media exists', async ({ page }) => {
    await page.goto('/media');

    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    const hasData = await firstRow.isVisible().catch(() => false);
    if (!hasData) {
      test.skip(true, 'No media items to test with');
      return;
    }

    await firstRow.getByRole('button', { name: /options/i }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    await expect(page.getByText('Delete file?')).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText('Delete file?')).not.toBeVisible();
  });
});
