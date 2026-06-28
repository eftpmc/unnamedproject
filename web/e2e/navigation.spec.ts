import { test, expect } from '@playwright/test';

// More specific selector for the command palette input (avoids matching the chats page search bar)
const paletteInput = (page: Parameters<typeof test>[1] extends { page: infer P } ? P : import('@playwright/test').Page) =>
  page.locator('[cmdk-input]');

test.describe('navigation', () => {
  test('home page loads', async ({ page }) => {
    await page.goto('/home');
    await expect(page).toHaveURL('/home');
    await expect(page).not.toHaveURL('/login');
  });

  test('chats page loads', async ({ page }) => {
    await page.goto('/chats');
    await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
  });

  test('projects page loads', async ({ page }) => {
    await page.goto('/projects');
    await expect(page).not.toHaveURL('/login');
  });

  test('command palette opens with Cmd+K', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await expect(page.locator('[cmdk-input]')).toBeVisible();
  });

  test('command palette closes with Escape', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await expect(page.locator('[cmdk-input]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[cmdk-input]')).not.toBeVisible();
  });

  test('command palette shows navigation items when empty', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await expect(page.getByRole('option', { name: /New chat/ })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Home' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Projects' })).toBeVisible();
  });

  test('command palette navigates to chats via Go To item', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await page.getByRole('option', { name: 'Chats' }).click();
    await expect(page).toHaveURL('/chats');
  });

  test('sidebar shows nav labels when pinned', async ({ page }) => {
    await page.goto('/chats');
    const pinBtn = page.getByTitle(/pin/i).first();
    if (await pinBtn.isVisible()) {
      await pinBtn.click();
      await expect(page.getByText('Chats').first()).toBeVisible();
    }
  });
});
