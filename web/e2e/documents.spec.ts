import { test, expect } from '@playwright/test';
import { PLAYWRIGHT_TOKEN, createProject, deleteProject, createGlobalDocument, deleteDocument } from './helpers.js';

const AUTH = { Authorization: `Bearer ${PLAYWRIGHT_TOKEN}` };

test.describe('documents page', () => {
  let projectId: string;
  let spaceId: string;
  let documentId: string;

  test.beforeAll(async ({ request }) => {
    projectId = await createProject(request, 'Playwright docs test project');
    const res = await request.get(`http://localhost:3000/projects/${projectId}`, { headers: AUTH });
    const project = await res.json() as { space_id: string };
    spaceId = project.space_id;
    documentId = await createGlobalDocument(request, spaceId, 'Playwright test doc');
  });

  test.afterAll(async ({ request }) => {
    await deleteDocument(request, documentId);
    await deleteProject(request, projectId);
  });

  test('documents page loads with document list', async ({ page }) => {
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

  test('delete option opens confirmation dialog and cancel works', async ({ page }) => {
    await page.goto('/documents');
    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    await expect(firstRow).toBeVisible();

    await firstRow.getByRole('button', { name: /options/i }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    await expect(page.getByText('Delete document?')).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText('Delete document?')).not.toBeVisible();
  });

  test('clicking a document row link navigates to document page', async ({ page }) => {
    await page.goto('/documents');
    const firstRow = page.locator('[data-slot="data-table-row"]').first();
    await expect(firstRow).toBeVisible();

    await firstRow.getByRole('link').first().click();
    await expect(page).toHaveURL(/\/documents\/.+/);
    await expect(page.getByRole('heading')).toBeVisible();
  });

  test('new document button opens dialog', async ({ page }) => {
    await page.goto('/documents');
    await page.getByRole('button', { name: 'New document' }).click();

    await expect(page.getByRole('dialog', { name: 'New document' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'New document' })).not.toBeVisible();
  });
});
