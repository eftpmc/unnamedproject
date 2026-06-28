import { test, expect } from '@playwright/test';
import { createProject, createTrigger, deleteProject } from './helpers.js';

test.describe('triggers page', () => {
  let projectId: string;
  let triggerId: string;

  test.beforeAll(async ({ request }) => {
    projectId = await createProject(request, 'Playwright trigger project');
    triggerId = await createTrigger(request, projectId, 'manual');
  });

  test.afterAll(async ({ request }) => {
    // Deleting the project cascades to its triggers
    await deleteProject(request, projectId);
  });

  test('triggers page loads with list', async ({ page }) => {
    await page.goto('/triggers');
    await expect(page.getByRole('heading', { name: 'Triggers' })).toBeVisible();
    await expect(page.locator('[data-slot="data-table-row"]').first()).toBeVisible();
  });

  test('trigger row has options menu with delete', async ({ page }) => {
    await page.goto('/triggers');
    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    await expect(firstRow).toBeVisible();

    await firstRow.getByRole('button', { name: /options/i }).click();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  });

  test('trigger row has toggle switch', async ({ page }) => {
    await page.goto('/triggers');
    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    await expect(firstRow).toBeVisible();

    const toggle = firstRow.getByRole('switch');
    await expect(toggle).toBeVisible();

    const initialState = await toggle.getAttribute('aria-checked');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', initialState === 'true' ? 'false' : 'true');
  });

  test('delete shows confirm dialog and cancel works', async ({ page }) => {
    await page.goto('/triggers');
    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    await expect(firstRow).toBeVisible();

    await firstRow.getByRole('button', { name: /options/i }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    await expect(page.getByText('Delete trigger?')).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText('Delete trigger?')).not.toBeVisible();
  });

  test('triggers page heading is present', async ({ page }) => {
    await page.goto('/triggers');
    await expect(page.getByRole('heading', { name: 'Triggers' })).toBeVisible();
  });
});
