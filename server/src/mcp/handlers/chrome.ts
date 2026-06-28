import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { chromium, type BrowserContext } from 'playwright';
import { registerTool } from '../registry.js';
import { getDb } from '../../db/index.js';
import { createExecution, completeExecution, requestApproval } from '../../services/executor.js';

const CDP_URL = 'http://localhost:9222';

// Per-user browser contexts kept alive between tool calls
const contexts = new Map<string, BrowserContext>();

function chromeProfilePath(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
}

function isChromeRunning(): boolean {
  try {
    execSync('pgrep -f "Google Chrome" > /dev/null 2>&1', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function getContext(userId: string): Promise<{ ctx: BrowserContext; mode: 'cdp' | 'launched' } | null> {
  const existing = contexts.get(userId);
  if (existing) {
    try {
      existing.pages(); // throws if disconnected
      return { ctx: existing, mode: 'cdp' };
    } catch {
      contexts.delete(userId);
    }
  }

  // Try CDP attach
  try {
    const browser = await chromium.connectOverCDP(CDP_URL);
    const ctx = browser.contexts()[0] ?? await browser.newContext();
    contexts.set(userId, ctx);
    browser.on('disconnected', () => contexts.delete(userId));
    return { ctx, mode: 'cdp' };
  } catch {
    // CDP not available
  }

  // Chrome running but no debug port — caller must ask for restart
  if (isChromeRunning()) return null;

  // Chrome not running at all — launch with user's profile
  try {
    const ctx = await chromium.launchPersistentContext(chromeProfilePath(), {
      channel: 'chrome',
      headless: false,
      args: ['--remote-debugging-port=9222', '--no-first-run'],
    });
    contexts.set(userId, ctx);
    ctx.browser()?.on('disconnected', () => contexts.delete(userId));
    return { ctx, mode: 'launched' };
  } catch (err) {
    throw new Error(`Failed to launch Chrome: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function hasChrome(userId: string): boolean {
  const row = getDb()
    .prepare("SELECT id FROM connections WHERE user_id = ? AND type = 'chrome' LIMIT 1")
    .get(userId);
  return !!row;
}

async function resolveContext(userId: string): Promise<BrowserContext> {
  const result = await getContext(userId);
  if (result) return result.ctx;
  throw new Error(
    'Chrome is running but remote debugging is not enabled. ' +
    'Call browser_restart_chrome to restart Chrome with the remote debugging port enabled.'
  );
}

async function activePage(ctx: BrowserContext) {
  const pages = ctx.pages();
  if (pages.length === 0) return ctx.newPage();
  return pages[pages.length - 1];
}

export function registerChromeHandlers(): void {

  registerTool({
    name: 'browser_navigate',
    description: 'Navigate the Chrome browser to a URL. Chrome must be enabled in Settings → MCP.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        wait_until: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'], description: 'When to consider navigation done (default: load)' },
      },
      required: ['url'],
    },
    handler: async (args, userId) => {
      if (!hasChrome(userId)) return 'Chrome browser is not enabled. Enable it in Settings → MCP → Chrome Browser.';
      const ctx = await resolveContext(userId);
      const page = await activePage(ctx);
      await page.goto(args.url as string, { waitUntil: (args.wait_until as 'load' | 'domcontentloaded' | 'networkidle') ?? 'load' });
      return `Navigated to ${page.url()}`;
    },
  });

  registerTool({
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current Chrome tab. Returns base64 PNG.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => {
      if (!hasChrome(userId)) return 'Chrome browser is not enabled. Enable it in Settings → MCP → Chrome Browser.';
      const ctx = await resolveContext(userId);
      const page = await activePage(ctx);
      const buf = await page.screenshot({ type: 'png' });
      return `data:image/png;base64,${buf.toString('base64')}`;
    },
  });

  registerTool({
    name: 'browser_click',
    description: 'Click an element in Chrome by CSS selector or text.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector or text= selector' },
      },
      required: ['selector'],
    },
    handler: async (args, userId) => {
      if (!hasChrome(userId)) return 'Chrome browser is not enabled. Enable it in Settings → MCP → Chrome Browser.';
      const ctx = await resolveContext(userId);
      const page = await activePage(ctx);
      await page.click(args.selector as string);
      return `Clicked ${args.selector}`;
    },
  });

  registerTool({
    name: 'browser_fill',
    description: 'Fill a form field in Chrome.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['selector', 'value'],
    },
    handler: async (args, userId) => {
      if (!hasChrome(userId)) return 'Chrome browser is not enabled. Enable it in Settings → MCP → Chrome Browser.';
      const ctx = await resolveContext(userId);
      const page = await activePage(ctx);
      await page.fill(args.selector as string, args.value as string);
      return `Filled ${args.selector}`;
    },
  });

  registerTool({
    name: 'browser_evaluate',
    description: 'Run JavaScript in the current Chrome tab and return the result.',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'JavaScript expression to evaluate' },
      },
      required: ['script'],
    },
    handler: async (args, userId) => {
      if (!hasChrome(userId)) return 'Chrome browser is not enabled. Enable it in Settings → MCP → Chrome Browser.';
      const ctx = await resolveContext(userId);
      const page = await activePage(ctx);
      const result = await page.evaluate(args.script as string);
      return JSON.stringify(result ?? null);
    },
  });

  registerTool({
    name: 'browser_get_text',
    description: 'Get the visible text content of the current Chrome page.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => {
      if (!hasChrome(userId)) return 'Chrome browser is not enabled. Enable it in Settings → MCP → Chrome Browser.';
      const ctx = await resolveContext(userId);
      const page = await activePage(ctx);
      const text = await page.evaluate(() => document.body.innerText);
      return String(text).slice(0, 20000);
    },
  });

  registerTool({
    name: 'browser_tabs',
    description: 'List open tabs in Chrome with their title and URL.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => {
      if (!hasChrome(userId)) return 'Chrome browser is not enabled. Enable it in Settings → MCP → Chrome Browser.';
      const ctx = await resolveContext(userId);
      const pages = ctx.pages();
      const tabs = await Promise.all(pages.map(async (p, i) => ({ index: i, url: p.url(), title: await p.title() })));
      return JSON.stringify(tabs, null, 2);
    },
  });

  registerTool({
    name: 'browser_new_tab',
    description: 'Open a new tab in Chrome and optionally navigate to a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Optional URL to navigate to in the new tab' },
      },
    },
    handler: async (args, userId) => {
      if (!hasChrome(userId)) return 'Chrome browser is not enabled. Enable it in Settings → MCP → Chrome Browser.';
      const ctx = await resolveContext(userId);
      const page = await ctx.newPage();
      if (args.url) await page.goto(args.url as string);
      return `Opened new tab${args.url ? ` at ${page.url()}` : ''}`;
    },
  });

  registerTool({
    name: 'browser_restart_chrome',
    description: 'Restart Chrome with remote debugging enabled so the agent can control your browser. Requires user approval.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId, sessionId) => {
      if (!hasChrome(userId)) return 'Chrome browser is not enabled. Enable it in Settings → MCP → Chrome Browser.';

      const executionId = createExecution(userId, null, null, 'browser_restart_chrome');

      const decision = await requestApproval(
        executionId,
        userId,
        'Restart Chrome with remote debugging',
        {
          reason: 'Chrome is running without remote debugging. The agent needs to restart Chrome to control your browser. Your session and tabs will be restored from your Chrome profile.',
          session_id: sessionId,
        },
        'user',
      );

      if (decision === 'rejected') {
        completeExecution(executionId, userId, 'error', 'User rejected Chrome restart');
        return 'Chrome restart was rejected. You can manually relaunch Chrome with: open -a "Google Chrome" --args --remote-debugging-port=9222';
      }

      // Gracefully quit Chrome so it saves the session before restarting
      contexts.delete(userId);
      try {
        execSync('osascript -e \'tell application "Google Chrome" to quit\'', { stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 2000));
      } catch { /* Chrome wasn't running */ }

      // Ensure it's fully gone before relaunching
      try {
        execSync('pkill -f "Google Chrome"', { stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 500));
      } catch { /* already gone */ }

      // Relaunch Chrome normally with the remote debugging flag — this restores the saved session
      try {
        execSync('open -a "Google Chrome" --args --remote-debugging-port=9222', { stdio: 'ignore' });
      } catch (err) {
        const msg = `Failed to launch Chrome: ${err instanceof Error ? err.message : String(err)}`;
        completeExecution(executionId, userId, 'error', msg);
        return msg;
      }

      // Wait for CDP to become available (up to 10 s)
      let cdpReady = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const browser = await chromium.connectOverCDP(CDP_URL);
          const ctx = browser.contexts()[0] ?? await browser.newContext();
          contexts.set(userId, ctx);
          browser.on('disconnected', () => contexts.delete(userId));
          cdpReady = true;
          break;
        } catch { /* not ready yet */ }
      }

      if (!cdpReady) {
        completeExecution(executionId, userId, 'error', 'Chrome launched but CDP not yet available — try a browser tool in a moment');
        return 'Chrome is launching. Wait a few seconds then retry your browser command.';
      }

      completeExecution(executionId, userId, 'done', 'Chrome restarted with remote debugging on port 9222');
      return 'Chrome restarted with remote debugging enabled. Your previous tabs have been restored.';
    },
  });
}
