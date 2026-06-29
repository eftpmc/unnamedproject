import { test, expect } from '@playwright/test';
import { createProject, deleteProject, createGlobalDocument, deleteDocument, PLAYWRIGHT_TOKEN } from './helpers.js';

const AUTH = { Authorization: `Bearer ${PLAYWRIGHT_TOKEN}` };

test.describe('command palette', () => {
  let projectId: string;
  let spaceId: string;
  let documentId: string;

  test.beforeAll(async ({ request }) => {
    projectId = await createProject(request, 'Playwright palette project');
    const res = await request.get(`http://localhost:3000/projects/${projectId}`, { headers: AUTH });
    const body = await res.json() as { space_id: string };
    spaceId = body.space_id;
    documentId = await createGlobalDocument(request, spaceId, 'Playwright palette document');
  });

  test.afterAll(async ({ request }) => {
    await deleteDocument(request, documentId).catch(() => {});
    await deleteProject(request, projectId);
  });

  test('⌘K opens the command palette', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
  });

  test('⌘K again closes the palette', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
    await page.keyboard.press('Meta+k');
    await expect(page.getByRole('dialog', { name: 'Search' })).not.toBeVisible();
  });

  test('Escape closes the palette', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Search' })).not.toBeVisible();
  });

  test('shows Actions and Go to sections when no query', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await expect(page.getByText('Actions')).toBeVisible();
    await expect(page.getByText('Go to')).toBeVisible();
    await expect(page.getByRole('option', { name: 'New chat' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'New document' })).toBeVisible();
  });

  test('Go to items navigate correctly', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await page.getByRole('option', { name: 'Projects' }).click();
    await expect(page).toHaveURL('/projects');
    await expect(page.getByRole('dialog', { name: 'Search' })).not.toBeVisible();
  });

  test('searching finds a project by name', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder(/search/i).fill('Playwright palette project');
    await expect(page.getByText('Projects')).toBeVisible();
    await expect(page.getByRole('option', { name: /Playwright palette project/ })).toBeVisible();
  });

  test('searching finds a document by title', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder(/search/i).fill('Playwright palette document');
    await expect(page.getByText('Documents')).toBeVisible();
    await expect(page.getByRole('option', { name: /Playwright palette document/ })).toBeVisible();
  });

  test('clicking a project result navigates to project page', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder(/search/i).fill('Playwright palette project');
    await page.getByRole('option', { name: /Playwright palette project/ }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));
  });

  test('clicking a document result navigates to document page', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder(/search/i).fill('Playwright palette document');
    await page.getByRole('option', { name: /Playwright palette document/ }).click();
    await expect(page).toHaveURL(new RegExp(`/documents/${documentId}`));
  });

  test('New document action opens create dialog on documents page', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await page.getByRole('option', { name: 'New document' }).click();
    await expect(page).toHaveURL('/documents');
    await expect(page.getByRole('dialog', { name: 'New document' })).toBeVisible({ timeout: 3000 });
  });

  test('no results message shown for unmatched search', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder(/search/i).fill('xyzzy-definitely-not-a-match-12345');
    await expect(page.getByText(/no results/i)).toBeVisible();
  });
});
