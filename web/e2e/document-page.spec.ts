import { test, expect } from '@playwright/test';
import { PLAYWRIGHT_TOKEN, createProject, deleteProject, createGlobalDocument, deleteDocument } from './helpers.js';

const AUTH = { Authorization: `Bearer ${PLAYWRIGHT_TOKEN}` };

test.describe('document page', () => {
  let projectId: string;
  let spaceId: string;
  let documentId: string;

  test.beforeAll(async ({ request }) => {
    projectId = await createProject(request, 'Playwright docpage test project');
    const res = await request.get(`http://localhost:3000/projects/${projectId}`, { headers: AUTH });
    const project = await res.json() as { space_id: string };
    spaceId = project.space_id;
    documentId = await createGlobalDocument(request, spaceId, 'Playwright docpage test');
  });

  test.afterAll(async ({ request }) => {
    // May already be deleted by the delete test — ignore 404
    await deleteDocument(request, documentId).catch(() => {});
    await deleteProject(request, projectId);
  });

  test('document page loads with title and content', async ({ page }) => {
    await page.goto(`/documents/${documentId}`);
    await expect(page.getByRole('heading', { name: 'Playwright docpage test' })).toBeVisible();
    // Edit and delete buttons should be visible
    await expect(page.getByRole('button', { name: /edit/i })).toBeVisible();
  });

  test('breadcrumb links back to documents list', async ({ page }) => {
    await page.goto(`/documents/${documentId}`);
    await page.getByRole('link', { name: 'Documents' }).click();
    await expect(page).toHaveURL('/documents');
  });

  test('edit button toggles edit mode with title input and save button', async ({ page }) => {
    await page.goto(`/documents/${documentId}`);
    await page.getByRole('button', { name: /edit/i }).click();

    await expect(page.getByRole('button', { name: /save/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
    // Title input should be present and contain the document title
    await expect(page.getByPlaceholder('Document title')).toBeVisible();
    await expect(page.getByPlaceholder('Document title')).toHaveValue('Playwright docpage test');
  });

  test('cancel exits edit mode without saving', async ({ page }) => {
    await page.goto(`/documents/${documentId}`);
    await page.getByRole('button', { name: /edit/i }).click();

    const titleInput = page.getByPlaceholder('Document title');
    await titleInput.fill('Changed title');
    await page.getByRole('button', { name: /cancel/i }).click();

    // Should be back in view mode with original title
    await expect(page.getByRole('heading', { name: 'Playwright docpage test' })).toBeVisible();
    await expect(page.getByRole('button', { name: /edit/i })).toBeVisible();
  });

  test('⌘S saves in edit mode', async ({ page }) => {
    await page.goto(`/documents/${documentId}`);
    await page.getByRole('button', { name: /edit/i }).click();

    const titleInput = page.getByPlaceholder('Document title');
    await titleInput.fill('Playwright docpage updated');
    await page.keyboard.press('Meta+s');

    // Should exit edit mode after save
    await expect(page.getByRole('button', { name: /edit/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Playwright docpage updated' })).toBeVisible();
  });

  test('delete button shows confirm dialog and cancel works', async ({ page }) => {
    await page.goto(`/documents/${documentId}`);
    // Trash icon button is next to Edit
    await page.locator('button[class*="hover:text-destructive"]').click();

    await expect(page.getByText('Delete document?')).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText('Delete document?')).not.toBeVisible();
  });

  test('confirming delete navigates to /documents', async ({ page }) => {
    // This test permanently deletes the document — must run last
    await page.goto(`/documents/${documentId}`);
    await page.locator('button[class*="hover:text-destructive"]').click();

    await expect(page.getByText('Delete document?')).toBeVisible();
    await page.getByRole('button', { name: /^delete$/i }).click();

    await expect(page).toHaveURL('/documents', { timeout: 5000 });
  });
});
