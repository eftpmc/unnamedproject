import { test, expect } from '@playwright/test';

test.describe('settings page', () => {
  test('redirects /settings to /settings/tools', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL('/settings/tools');
  });

  test('tools section loads', async ({ page }) => {
    await page.goto('/settings/tools');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Tools')).toBeVisible();
  });

  test('mcp section loads', async ({ page }) => {
    await page.goto('/settings/mcp');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('workspace section loads', async ({ page }) => {
    await page.goto('/settings/workspace');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('memory section loads', async ({ page }) => {
    await page.goto('/settings/memory');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('appearance section loads', async ({ page }) => {
    await page.goto('/settings/appearance');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('nav links between sections', async ({ page }) => {
    await page.goto('/settings/tools');
    await page.getByRole('link', { name: 'Memory' }).click();
    await expect(page).toHaveURL('/settings/memory');
  });
});
