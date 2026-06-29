import { registerTool } from '../registry.js';
import { getDb } from '../../db/index.js';
import { callChromeBridge, isChromeBridgeConnected } from '../../services/chromeBridge.js';

function hasChrome(userId: string): boolean {
  const row = getDb()
    .prepare("SELECT id FROM connections WHERE user_id = ? AND type = 'chrome' LIMIT 1")
    .get(userId);
  return !!row;
}

async function chromeTool(userId: string, method: string, params: Record<string, unknown> = {}): Promise<string> {
  if (!hasChrome(userId)) return 'Chrome browser is not enabled. Enable it in Settings -> Tools -> Chrome Browser.';
  const result = await callChromeBridge(userId, method, params);
  return typeof result === 'string' ? result : JSON.stringify(result ?? null, null, 2);
}

export function registerChromeHandlers(): void {
  registerTool({
    name: 'browser_navigate',
    description: 'Navigate the connected Chrome browser to a URL. Requires the Unnamed Chrome extension to be connected.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        wait_until: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'], description: 'Accepted for compatibility; the extension waits for the tab to finish loading.' },
      },
      required: ['url'],
    },
    handler: async (args, userId) => chromeTool(userId, 'navigate', { url: args.url }),
  });

  registerTool({
    name: 'browser_screenshot',
    description: 'Take a screenshot of the active connected Chrome tab. Returns base64 PNG. WARNING: screenshots are image payloads costing ~10–20× more tokens than text. Only use when you need to see visual layout or debug a UI interaction. For reading page content, use browser_extract instead.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => chromeTool(userId, 'screenshot'),
  });

  registerTool({
    name: 'browser_extract',
    description: 'Extract content from the active Chrome page as text — no screenshot, no image tokens. Much cheaper than browser_screenshot. Use this for reading job listings, profiles, search results, articles, or any structured content. format=text: visible text; format=json: structured cards/tables/lists/headings; format=links: all links with text+href.',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['text', 'links', 'json'],
          description: 'text: all visible page text (default); links: anchor links with text+href; json: structured extraction of cards, tables, lists, headings',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to scope extraction to a specific container element',
        },
      },
    },
    handler: async (args, userId) => {
      const format = (args.format as string) || 'text';

      if (format === 'text') {
        return chromeTool(userId, 'getText');
      }

      if (format === 'links') {
        return chromeTool(userId, 'evaluate', {
          script: `JSON.stringify([...document.querySelectorAll('a[href]')].map(a=>({text:a.innerText.trim(),href:a.href})).filter(l=>l.text&&l.href&&!l.href.startsWith('javascript')).slice(0,150))`,
        });
      }

      // json: structured extraction
      const selector = args.selector as string | undefined;
      const rootExpr = selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.body';
      return chromeTool(userId, 'evaluate', {
        script: `(()=>{
  const root=${rootExpr};
  if(!root) return JSON.stringify({error:'selector not found'});
  const seen=new Set();
  const items=[];
  function add(t){t=t&&t.trim();if(t&&t.length>10&&!seen.has(t)){seen.add(t);items.push(t);}}
  // Semantic containers first (job cards, result items, article blocks)
  root.querySelectorAll('[class*="job"],[class*="card"],[class*="listing"],[class*="result"],[class*="item"],[class*="post"],article,section').forEach(el=>{
    const t=el.innerText.trim();if(t.length>20&&t.length<2000)add(t);
  });
  // Tables
  root.querySelectorAll('table tr').forEach(tr=>{
    const row=[...tr.querySelectorAll('td,th')].map(td=>td.innerText.trim()).filter(Boolean).join(' | ');
    if(row)add(row);
  });
  // Lists
  root.querySelectorAll('ul>li,ol>li').forEach(li=>add(li.innerText));
  // Headings+paragraphs as fallback
  if(items.length<5){
    root.querySelectorAll('h1,h2,h3,h4,h5,p').forEach(el=>add(el.innerText));
  }
  return JSON.stringify({title:document.title,url:location.href,items:items.slice(0,300)});
})()`,
      });
    },
  });

  registerTool({
    name: 'browser_click',
    description: 'Click an element in Chrome by CSS selector or text= selector.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector or text= selector' },
      },
      required: ['selector'],
    },
    handler: async (args, userId) => chromeTool(userId, 'click', { selector: args.selector }),
  });

  registerTool({
    name: 'browser_fill',
    description: 'Fill a form field in Chrome by CSS selector or text= selector.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['selector', 'value'],
    },
    handler: async (args, userId) => chromeTool(userId, 'fill', { selector: args.selector, value: args.value }),
  });

  registerTool({
    name: 'browser_evaluate',
    description: 'Run JavaScript in the active connected Chrome tab and return the result.',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'JavaScript expression to evaluate' },
      },
      required: ['script'],
    },
    handler: async (args, userId) => chromeTool(userId, 'evaluate', { script: args.script }),
  });

  registerTool({
    name: 'browser_get_text',
    description: 'Get the visible text content of the active connected Chrome page.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => chromeTool(userId, 'getText'),
  });

  registerTool({
    name: 'browser_tabs',
    description: 'List open tabs in the connected Chrome profile with their title and URL.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => chromeTool(userId, 'tabs'),
  });

  registerTool({
    name: 'browser_select_tab',
    description: 'Select an open Chrome tab by index from browser_tabs. Use this when login or OAuth opens a new tab/window.',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Tab index from browser_tabs' },
      },
      required: ['index'],
    },
    handler: async (args, userId) => chromeTool(userId, 'selectTab', { index: args.index }),
  });

  registerTool({
    name: 'browser_new_tab',
    description: 'Open a new tab in the connected Chrome profile and optionally navigate to a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Optional URL to navigate to in the new tab' },
      },
    },
    handler: async (args, userId) => chromeTool(userId, 'newTab', { url: args.url }),
  });

  registerTool({
    name: 'browser_press_key',
    description: 'Press a key on the currently focused element in Chrome. Use "Enter" to submit a form or activate a focused button, "Tab" to move focus, "Escape" to dismiss. Detects resulting navigation.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press: "Enter", "Tab", "Escape", "Space", "ArrowDown", "ArrowUp", or a character', enum: ['Enter', 'Tab', 'Escape', 'Space', 'ArrowDown', 'ArrowUp'] },
      },
      required: ['key'],
    },
    handler: async (args, userId) => chromeTool(userId, 'pressKey', { key: String(args.key || 'Enter') }),
  });

  registerTool({
    name: 'browser_autofill',
    description: 'Fill a login form in the connected Chrome tab with a username and password using React-compatible native input events. Optionally submits the form. Use vault_get to retrieve credentials before calling this.',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Username or email to fill' },
        password: { type: 'string', description: 'Password to fill' },
        submit: { type: 'boolean', description: 'Whether to click the submit button after filling (default: true)' },
      },
      required: ['username', 'password'],
    },
    handler: async (args, userId) =>
      chromeTool(userId, 'autofill', {
        username: String(args.username),
        password: String(args.password),
        submit: args.submit !== false,
      }),
  });

  registerTool({
    name: 'browser_restart_chrome',
    description: 'Compatibility tool. The extension-backed Chrome connector does not restart Chrome; it reports connection status and setup guidance.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => {
      if (!hasChrome(userId)) return 'Chrome browser is not enabled. Enable it in Settings -> Tools -> Chrome Browser.';
      if (isChromeBridgeConnected(userId)) return 'Chrome extension is connected. Use browser_navigate, browser_tabs, and related tools.';
      return 'Chrome extension is not connected. Install or reload the Unnamed Chrome extension from chrome-extension/, open its options, paste your local app token, and connect it to this server.';
    },
  });
}
