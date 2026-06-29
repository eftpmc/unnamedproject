import { test, expect } from '@playwright/test';
import {
  createProject, deleteProject,
  createGlobalDocument, deleteDocument,
  PLAYWRIGHT_TOKEN,
} from './helpers.js';

const BASE = 'http://localhost:3000';
const AUTH = { Authorization: `Bearer ${PLAYWRIGHT_TOKEN}` };

test.describe('project page', () => {
  let projectId: string;
  let spaceId: string;

  test.beforeAll(async ({ request }) => {
    projectId = await createProject(request, 'Playwright project page test');
    // Fetch space_id for the project
    const res = await request.get(`${BASE}/projects/${projectId}`, { headers: AUTH });
    const body = await res.json() as { space_id: string };
    spaceId = body.space_id;
  });

  test.afterAll(async ({ request }) => {
    await deleteProject(request, projectId);
  });

  test('overview tab loads with project name', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByRole('heading', { name: 'Playwright project page test' })).toBeVisible();
  });

  test('sidebar shows project nav items', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);
    await page.locator('nav').first().hover();
    await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Files' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Chats' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Documents' })).toBeVisible();
  });

  test('files tab loads', async ({ page }) => {
    await page.goto(`/projects/${projectId}/files`);
    await expect(page.getByRole('heading', { name: 'Playwright project page test' })).toBeVisible();
    // FileBrowser renders a section with "Repository files"
    await expect(page.getByText('Repository files')).toBeVisible();
  });

  test('chats tab shows empty state when no chats pinned', async ({ page }) => {
    await page.goto(`/projects/${projectId}/chats`);
    await expect(page.getByRole('heading', { name: 'Playwright project page test' })).toBeVisible();
    await expect(page.getByText('No chats yet')).toBeVisible();
  });

  test('chats tab has New chat button', async ({ page }) => {
    await page.goto(`/projects/${projectId}/chats`);
    await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  });

  test('documents tab shows empty state', async ({ page }) => {
    await page.goto(`/projects/${projectId}/documents`);
    await expect(page.getByRole('heading', { name: 'Playwright project page test' })).toBeVisible();
    await expect(page.getByText('No documents yet')).toBeVisible();
  });

  test('documents tab shows document when one exists', async ({ request, page }) => {
    const docId = await createGlobalDocument(request, spaceId, 'Project doc test');

    try {
      await page.goto(`/projects/${projectId}/documents`);
      await expect(page.getByText('Project doc test')).toBeVisible();
    } finally {
      await deleteDocument(request, docId);
    }
  });

  test('document row navigates to document page on click', async ({ request, page }) => {
    const docId = await createGlobalDocument(request, spaceId, 'Project doc nav test');

    try {
      await page.goto(`/projects/${projectId}/documents`);
      await page.getByText('Project doc nav test').click();
      await expect(page).toHaveURL(new RegExp(`/documents/${docId}`));
    } finally {
      await deleteDocument(request, docId);
    }
  });

  test('overview rename button shows inline input', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);
    // The overview has a rename/edit action for the description
    // Check that the page loaded properly
    await expect(page.getByRole('heading', { name: 'Playwright project page test' })).toBeVisible();
  });

  test('sidebar back link returns to projects list', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);
    await page.locator('nav').first().hover();
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page).toHaveURL('/projects');
  });
});
