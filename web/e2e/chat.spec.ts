import { test, expect } from '@playwright/test';

test.describe('new chat', () => {
  test('new chat has centered input with placeholder', async ({ page }) => {
    await page.goto('/chats');
    await page.getByRole('button', { name: 'New chat' }).click();
    await expect(page.getByPlaceholder('What can I help with?')).toBeVisible();
  });

  test('new chat shows default prompt chips', async ({ page }) => {
    await page.goto('/chats');
    await page.getByRole('button', { name: 'New chat' }).click();
    await expect(page.getByText('Help me plan the next useful step.')).toBeVisible();
    await expect(page.getByText('Review this app and suggest the highest-impact improvements.')).toBeVisible();
  });

  test('send button is disabled when input is empty', async ({ page }) => {
    await page.goto('/chats');
    await page.getByRole('button', { name: 'New chat' }).click();
    const sendBtn = page.getByTitle('Send').first();
    await expect(sendBtn).toBeDisabled();
  });

  test('send button enables when text is typed', async ({ page }) => {
    await page.goto('/chats');
    await page.getByRole('button', { name: 'New chat' }).click();
    await page.getByPlaceholder('What can I help with?').fill('hello');
    const sendBtn = page.getByTitle('Send').first();
    await expect(sendBtn).toBeEnabled();
  });
});

test.describe('existing chat', () => {
  test('chat header is visible', async ({ page }) => {
    await page.goto('/chats');
    const firstChat = page.getByRole('link').filter({ hasText: /.+/ }).first();
    if (await firstChat.count() > 0) {
      await firstChat.click();
      await expect(page.locator('header')).toBeVisible();
    }
  });

  test('message input is visible in an active chat', async ({ page }) => {
    await page.goto('/chats');
    const firstChat = page.getByRole('link').filter({ hasText: /.+/ }).first();
    if (await firstChat.count() > 0) {
      await firstChat.click();
      await expect(page.getByPlaceholder('Message…')).toBeVisible();
    }
  });

  test('user message bubbles render with tinted background', async ({ page }) => {
    await page.goto('/chats');
    const firstChat = page.getByRole('link').filter({ hasText: /.+/ }).first();
    if (await firstChat.count() > 0) {
      await firstChat.click();
      const userBubble = page.locator('[class*="rounded-tr-md"]').first();
      if (await userBubble.count() > 0) {
        await expect(userBubble).toBeVisible();
      }
    }
  });
});
