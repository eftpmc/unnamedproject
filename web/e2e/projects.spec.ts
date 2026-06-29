import { test, expect } from '@playwright/test';
import { createProject, deleteProject } from './helpers.js';

test.describe('projects page', () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    projectId = await createProject(request, 'Playwright test project');
  });

  test.afterAll(async ({ request }) => {
    await deleteProject(request, projectId);
  });

  test('projects page loads with list', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.locator('[data-slot="data-table-row"]').first()).toBeVisible();
  });

  test('project row has options menu with rename and delete', async ({ page }) => {
    await page.goto('/projects');
    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    await expect(firstRow).toBeVisible();

    await firstRow.getByRole('button', { name: /options/i }).click();

    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  });

  test('rename inline input appears and focuses', async ({ page }) => {
    await page.goto('/projects');
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

  test('rename commit on Enter updates name', async ({ page }) => {
    await page.goto('/projects');
    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    await expect(firstRow).toBeVisible();

    await firstRow.getByRole('button', { name: /options/i }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();

    const renameInput = firstRow.locator('input');
    await renameInput.fill('Playwright renamed project');
    await page.keyboard.press('Enter');

    await expect(renameInput).not.toBeVisible();
    await expect(firstRow.getByText('Playwright renamed project')).toBeVisible();
  });

  test('delete shows confirm dialog and cancel works', async ({ page }) => {
    await page.goto('/projects');
    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    await expect(firstRow).toBeVisible();

    await firstRow.getByRole('button', { name: /options/i }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    await expect(page.getByText(/Delete .+\?/)).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText(/Delete .+\?/)).not.toBeVisible();
  });

  test('new project button navigates to new project form', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('button', { name: 'New project' }).click();
    await expect(page).toHaveURL(/\/projects\/new/);
  });
});

test.describe('new project form', () => {
  let createdProjectId: string | null = null;

  test.afterAll(async ({ request }) => {
    if (createdProjectId) await deleteProject(request, createdProjectId);
  });

  test('cancel button returns to projects list', async ({ page }) => {
    await page.goto('/projects/new');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL('/projects');
  });

  test('submit is disabled until name is entered', async ({ page }) => {
    await page.goto('/projects/new');
    await expect(page.getByRole('button', { name: 'Create project' })).toBeDisabled();
    await page.getByPlaceholder('Project name').fill('x');
    await expect(page.getByRole('button', { name: 'Create project' })).toBeEnabled();
    await page.getByPlaceholder('Project name').fill('');
    await expect(page.getByRole('button', { name: 'Create project' })).toBeDisabled();
  });

  test('submitting form creates project and redirects to project page', async ({ page, request }) => {
    await page.goto('/projects/new');
    await page.getByPlaceholder('Project name').fill('Playwright new-project form test');
    await page.getByRole('button', { name: 'Create project' }).click();

    await expect(page).toHaveURL(/\/projects\/[^/]+$/, { timeout: 8000 });
    await expect(page.getByRole('heading', { name: 'Playwright new-project form test' })).toBeVisible();

    // Extract the created project ID for cleanup
    const url = page.url();
    createdProjectId = url.split('/projects/')[1] ?? null;
  });
});
