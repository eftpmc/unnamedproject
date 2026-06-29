const DEFAULT_APP_URL = 'http://localhost:3000';
const RECONNECT_DELAY_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_ALARM = 'unnamed-chrome-bridge-heartbeat';

let socket = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let activeTabId = null;

chrome.tabs.onActivated.addListener(info => {
  activeTabId = info.tabId;
});

chrome.windows.onFocusChanged.addListener(async windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab?.id) activeTabId = tab.id;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  connect().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  connect().catch(() => {});
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== HEARTBEAT_ALARM) return;
  connect().then(sendHeartbeat).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.appUrl || changes.token || changes.enabled) {
    disconnect();
    connect().catch(() => {});
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

async function getConfig() {
  const cfg = await chrome.storage.sync.get({
    enabled: false,
    appUrl: DEFAULT_APP_URL,
    token: '',
  });
  return {
    enabled: Boolean(cfg.enabled),
    appUrl: String(cfg.appUrl || DEFAULT_APP_URL).replace(/\/+$/, ''),
    token: String(cfg.token || '').trim(),
  };
}

function wsUrl(appUrl, token) {
  const url = new URL(appUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/chrome-bridge';
  url.searchParams.set('token', token);
  return url.toString();
}

function disconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  reconnectTimer = null;
  heartbeatTimer = null;
  if (socket) socket.close();
  socket = null;
}

async function connect() {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.token) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  socket = new WebSocket(wsUrl(cfg.appUrl, cfg.token));
  socket.onopen = () => {
    sendHeartbeat();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  };
  socket.onmessage = event => handleMessage(event.data);
  socket.onclose = () => scheduleReconnect();
  socket.onerror = () => {
    if (socket) socket.close();
  };
}

function scheduleReconnect() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  socket = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connect().catch(() => {}), RECONNECT_DELAY_MS);
}

function sendHeartbeat() {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'heartbeat', at: Date.now() }));
  }
}

async function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg?.id || !msg.method) return;

  try {
    const result = await dispatch(msg.method, msg.params || {});
    send({ id: msg.id, ok: true, result });
  } catch (err) {
    send({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

async function dispatch(method, params) {
  switch (method) {
    case 'navigate':
      return navigate(String(params.url || ''));
    case 'screenshot':
      return screenshot();
    case 'click':
      return clickWithNavigation(String(params.selector || ''));
    case 'fill':
      return runInTab(fillElement, [String(params.selector || ''), String(params.value || '')]);
    case 'evaluate':
      return runInTab(evaluateScript, [String(params.script || '')]);
    case 'getText':
      return runInTab(getPageText, []);
    case 'tabs':
      return listTabs();
    case 'newTab':
      return newTab(typeof params.url === 'string' ? params.url : undefined);
    case 'selectTab':
      return selectTab(Number(params.index));
    case 'pressKey':
      return pressKeyWithNavigation(String(params.key || 'Enter'));
    case 'autofill':
      return autofillWithNavigation(
        String(params.username || ''),
        String(params.password || ''),
        params.submit !== false,
      );
    default:
      throw new Error(`Unknown Chrome bridge method: ${method}`);
  }
}

async function getActiveTab() {
  if (activeTabId) {
    try {
      return await chrome.tabs.get(activeTabId);
    } catch {
      activeTabId = null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) {
    activeTabId = tab.id;
    return tab;
  }
  const created = await chrome.tabs.create({ url: 'about:blank', active: true });
  activeTabId = created.id;
  return created;
}

async function runInTab(func, args) {
  const tab = await getActiveTab();
  if (!tab.id) throw new Error('No active Chrome tab');
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func,
    args,
    world: 'MAIN',
  });
  return res?.result ?? null;
}

async function navigate(url) {
  if (!url) throw new Error('url is required');
  const tab = await getActiveTab();
  const updated = await chrome.tabs.update(tab.id, { url, active: true });
  activeTabId = updated.id;
  await waitForTabLoad(updated.id);
  const finalTab = await chrome.tabs.get(updated.id);
  return `Navigated to ${finalTab.url}`;
}

function waitForTabLoad(tabId, timeoutMs = 30_000) {
  return new Promise(resolve => {
    const timeout = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') done();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Send a real OS-level mouse click via the Chrome Debugger Protocol.
// event.isTrusted = true — indistinguishable from a physical click.
async function cdpClick(tabId, x, y) {
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  try {
    const base = { x, y, button: 'left', clickCount: 1, modifiers: 0 };
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
  } finally {
    try { await chrome.debugger.detach(target); } catch { /* already detached */ }
  }
}

// Click an element by selector using CDP (trusted OS-level events) and wait for navigation.
// Falls back to synthetic events if the element rect can't be resolved.
async function clickWithNavigation(selector) {
  const tab = await getActiveTab();
  if (!tab.id) throw new Error('No active Chrome tab');

  // For plain <a> tags navigate directly — no click needed.
  const [hrefRes] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: _extractHref,
    args: [selector],
  });
  const href = hrefRes?.result;
  if (href) {
    const updated = await chrome.tabs.update(tab.id, { url: href, active: true });
    activeTabId = updated.id;
    await waitForTabLoad(updated.id);
    const finalTab = await chrome.tabs.get(updated.id);
    return `Clicked ${selector} → navigated to ${finalTab.url}`;
  }

  // Get the element's center coordinates from inside the page.
  const [rectRes] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: _getElementRect,
    args: [selector],
  });
  const rect = rectRes?.result;

  const beforeUrl = tab.url;
  const tabsBefore = await chrome.tabs.query({});

  if (rect) {
    // CDP click — truly trusted, bypasses all bot detection.
    await cdpClick(tab.id, rect.x, rect.y);
  } else {
    // Fallback: synthetic events (element not found for CDP, but try anyway).
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: _clickElement,
      args: [selector],
    });
  }

  await new Promise(r => setTimeout(r, 700));

  const tabsAfter = await chrome.tabs.query({});
  if (tabsAfter.length > tabsBefore.length) {
    const newTab = tabsAfter.find(t => !tabsBefore.some(b => b.id === t.id));
    if (newTab?.id) {
      activeTabId = newTab.id;
      await chrome.tabs.update(newTab.id, { active: true });
      await waitForTabLoad(newTab.id);
      const finalTab = await chrome.tabs.get(newTab.id);
      return `Clicked ${selector} → new tab at ${finalTab.url}`;
    }
  }

  const currentTab = await getActiveTab();
  if (currentTab.url !== beforeUrl || currentTab.status === 'loading') {
    await waitForTabLoad(currentTab.id);
    const finalTab = await chrome.tabs.get(currentTab.id);
    return `Clicked ${selector} → navigated to ${finalTab.url}`;
  }

  return `Clicked ${selector}${rect ? ` at (${Math.round(rect.x)}, ${Math.round(rect.y)})` : ' (fallback)'}`;
}

async function screenshot() {
  const tab = await getActiveTab();
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map((tab, index) => ({
    index,
    id: tab.id,
    active: tab.active,
    title: tab.title || '',
    url: tab.url || '',
  }));
}

async function selectTab(index) {
  const tabs = await chrome.tabs.query({});
  const tab = tabs[index];
  if (!tab?.id) throw new Error(`No Chrome tab at index ${index}`);
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  activeTabId = tab.id;
  const selected = await chrome.tabs.get(tab.id);
  return { index, id: selected.id, title: selected.title || '', url: selected.url || '' };
}

async function newTab(url) {
  const tab = await chrome.tabs.create({ url: url || 'about:blank', active: true });
  activeTabId = tab.id;
  if (url) await waitForTabLoad(tab.id);
  const finalTab = await chrome.tabs.get(tab.id);
  return `Opened new tab${url ? ` at ${finalTab.url}` : ''}`;
}

// Press a key on the currently focused element and wait for any navigation.
async function pressKeyWithNavigation(key) {
  const tab = await getActiveTab();
  if (!tab.id) throw new Error('No active Chrome tab');
  const beforeUrl = tab.url;

  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: _pressKey,
    args: [key],
  });

  await new Promise(r => setTimeout(r, 800));
  const currentTab = await getActiveTab();
  if (currentTab.url !== beforeUrl || currentTab.status === 'loading') {
    await waitForTabLoad(currentTab.id);
    const finalTab = await chrome.tabs.get(currentTab.id);
    return `${res?.result ?? `Pressed ${key}`} → navigated to ${finalTab.url}`;
  }
  return res?.result ?? `Pressed ${key}`;
}

// Fill a login form and optionally submit, then wait for any resulting navigation.
async function autofillWithNavigation(username, password, submit) {
  const tab = await getActiveTab();
  if (!tab.id) throw new Error('No active Chrome tab');

  const beforeUrl = tab.url;
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: _autofillForm,
    args: [username, password, submit],
  });

  const summary = res?.result ?? 'Autofill complete';

  if (submit) {
    await new Promise(r => setTimeout(r, 800));
    const currentTab = await getActiveTab();
    if (currentTab.url !== beforeUrl || currentTab.status === 'loading') {
      await waitForTabLoad(currentTab.id);
      const finalTab = await chrome.tabs.get(currentTab.id);
      return `${summary} → navigated to ${finalTab.url}`;
    }
  }

  return summary;
}

// ─── Page-injected functions (MAIN world) ────────────────────────────────────
// These run inside the target page. They must be fully self-contained — they
// cannot reference anything from background.js scope.

// Returns the viewport center coords of the matched element (for CDP clicks).
function _getElementRect(selector) {
  function closest(el) {
    if (!el) return null;
    return el.closest('button, a, input, textarea, select, [role="button"], [tabindex]') || el;
  }
  function findEl(sel) {
    if (sel.startsWith('text=')) {
      const needle = sel.slice(5).trim().toLowerCase();
      const all = Array.from(document.querySelectorAll('button, a, input, textarea, select, [role="button"], [tabindex], div, span'));
      const match = all.find(el => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase().includes(needle));
      return closest(match);
    }
    return closest(document.querySelector(sel));
  }
  const el = findEl(selector);
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName, text: (el.innerText || '').trim().slice(0, 40) };
}

function _findElement(selector) {
  function closest(el) {
    if (!el) return null;
    return el.closest('button, a, input, textarea, select, [role="button"], [tabindex]') || el;
  }
  if (selector.startsWith('text=')) {
    const needle = selector.slice(5).trim().toLowerCase();
    const all = Array.from(document.querySelectorAll('button, a, input, textarea, select, [role="button"], [tabindex], div, span'));
    const match = all.find(el => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase().includes(needle));
    return closest(match);
  }
  return closest(document.querySelector(selector));
}

function _extractHref(selector) {
  function closest(el) {
    if (!el) return null;
    return el.closest('button, a, input, textarea, select, [role="button"], [tabindex]') || el;
  }
  function findEl(sel) {
    if (sel.startsWith('text=')) {
      const needle = sel.slice(5).trim().toLowerCase();
      const all = Array.from(document.querySelectorAll('button, a, input, textarea, select, [role="button"], [tabindex], div, span'));
      const match = all.find(el => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase().includes(needle));
      return closest(match);
    }
    return closest(document.querySelector(sel));
  }
  const el = findEl(selector);
  if (!el) return null;
  const anchor = el.tagName === 'A' ? el : el.closest('a');
  if (!anchor) return null;
  const href = anchor.href;
  if (!href || href === window.location.href || href.startsWith('javascript:') || href === window.location.href + '#') return null;
  return href;
}

function _clickElement(selector) {
  function closest(el) {
    if (!el) return null;
    return el.closest('button, a, input, textarea, select, [role="button"], [tabindex]') || el;
  }
  function findEl(sel) {
    if (sel.startsWith('text=')) {
      const needle = sel.slice(5).trim().toLowerCase();
      const all = Array.from(document.querySelectorAll('button, a, input, textarea, select, [role="button"], [tabindex], div, span'));
      const match = all.find(el => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase().includes(needle));
      return closest(match);
    }
    return closest(document.querySelector(sel));
  }
  const el = findEl(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  el.scrollIntoView({ block: 'center', inline: 'center' });

  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // detail:1 makes it look like a real click — some sites (including Handshake) check this.
  const init = {
    bubbles: true, cancelable: true, composed: true,
    clientX: cx, clientY: cy,
    screenX: window.screenX + cx, screenY: window.screenY + cy,
    detail: 1, buttons: 1, button: 0,
    view: window,
  };

  // Fire the full pointer+mouse sequence first so framework event handlers (React, Vue, etc.) run.
  for (const type of ['pointerover', 'mouseover', 'pointermove', 'mousemove',
                       'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, { ...init, buttons: type.includes('up') || type === 'click' ? 0 : 1 }));
  }

  // Native .click() as trusted-event fallback (bypasses React but triggers <a href> and submit).
  el.click();

  // Keyboard fallback: Enter key activates buttons and submits forms on sites that ignore mouse events.
  el.focus?.();
  const kInit = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
  el.dispatchEvent(new KeyboardEvent('keydown', kInit));
  el.dispatchEvent(new KeyboardEvent('keypress', kInit));
  el.dispatchEvent(new KeyboardEvent('keyup', kInit));

  // Form fallback: if this is a submit button, also try requestSubmit on its form.
  const isSubmit = el.type === 'submit' || el.getAttribute('type') === 'submit'
    || (el.tagName === 'BUTTON' && !el.type) || el.getAttribute('role') === 'button';
  if (isSubmit) {
    const form = el.closest('form');
    if (form) {
      try { form.requestSubmit(el.type === 'submit' ? el : null); } catch { form.submit(); }
    }
  }

  return `Clicked ${selector} [tag=${el.tagName} type=${el.type || '—'} text="${(el.innerText || '').trim().slice(0, 40)}"]`;
}

function fillElement(selector, value) {
  function closest(el) {
    if (!el) return null;
    return el.closest('button, a, input, textarea, select, [role="button"], [tabindex]') || el;
  }
  function findEl(sel) {
    if (sel.startsWith('text=')) {
      const needle = sel.slice(5).trim().toLowerCase();
      const all = Array.from(document.querySelectorAll('button, a, input, textarea, select, [role="button"], [tabindex], div, span'));
      const match = all.find(el => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase().includes(needle));
      return closest(match);
    }
    return closest(document.querySelector(sel));
  }
  const el = findEl(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  el.focus();
  el.value = value;
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return `Filled ${selector}`;
}

// Press a key on the currently focused element. Self-contained — no background.js scope access.
function _pressKey(key) {
  const el = document.activeElement || document.body;
  const keyMap = { Enter: 13, Tab: 9, Escape: 27, Space: 32, ArrowDown: 40, ArrowUp: 38 };
  const keyCode = keyMap[key] ?? key.charCodeAt(0);
  const init = { bubbles: true, cancelable: true, key, code: `Key${key}`, keyCode, which: keyCode, charCode: keyCode };
  el.dispatchEvent(new KeyboardEvent('keydown', init));
  el.dispatchEvent(new KeyboardEvent('keypress', init));
  el.dispatchEvent(new KeyboardEvent('keyup', init));

  if (key === 'Enter') {
    // If focused element is inside a form, submit it.
    const form = el.closest('form');
    if (form) {
      try { form.requestSubmit(); return `Pressed Enter → submitted form on ${el.tagName}`; }
      catch { form.submit(); return `Pressed Enter → form.submit() on ${el.tagName}`; }
    }
    // If it's a button, also click it.
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
      el.click();
      return `Pressed Enter + clicked ${el.tagName} "${(el.innerText || '').trim().slice(0, 40)}"`;
    }
  }

  return `Pressed ${key} on ${el.tagName}${el.id ? '#' + el.id : ''}`;
}

// Fill a login form with username+password using React-compatible native input events.
// This is self-contained — it cannot reference anything from background.js scope.
function _autofillForm(username, password, submit) {
  // Use the native HTMLInputElement setter so React's synthetic event system detects the change.
  function reactFill(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findInput(attrs) {
    for (const [attr, values] of attrs) {
      for (const v of values) {
        const el = document.querySelector(`input[${attr}="${v}"]`);
        if (el && el.offsetParent !== null) return el;
      }
    }
    // Fallback: scan all visible inputs
    for (const [attr, values] of attrs) {
      for (const v of values) {
        const el = document.querySelector(`input[${attr}*="${v}" i]`);
        if (el && el.offsetParent !== null) return el;
      }
    }
    return null;
  }

  const userAttrs = [
    ['type', ['email', 'text']],
    ['name', ['email', 'username', 'login', 'user']],
    ['id', ['email', 'username', 'login', 'user']],
    ['autocomplete', ['email', 'username']],
  ];
  const passAttrs = [
    ['type', ['password']],
    ['name', ['password', 'pass']],
    ['autocomplete', ['current-password', 'password']],
  ];

  const userEl = findInput(userAttrs);
  const passEl = findInput(passAttrs);
  const results = [];

  if (userEl) {
    userEl.focus();
    reactFill(userEl, username);
    results.push('filled username');
  } else {
    results.push('username field not found');
  }

  if (passEl) {
    passEl.focus();
    reactFill(passEl, password);
    results.push('filled password');
  } else {
    results.push('password field not found');
  }

  if (submit && (userEl || passEl)) {
    const activeEl = passEl || userEl;
    const form = activeEl.closest('form');
    const submitBtn = (form && form.querySelector('button[type="submit"], input[type="submit"]'))
      || document.querySelector('button[type="submit"]');

    // 1. requestSubmit(btn) — native form submission with the submit button as submitter.
    //    Triggers React/framework validation handlers and bypasses click-event issues.
    if (submitBtn && form) {
      try {
        form.requestSubmit(submitBtn);
        results.push('submitted via requestSubmit(btn)');
        return results.join('; ');
      } catch { /* submitter not part of form, fall through */ }
    }

    // 2. requestSubmit() without submitter — works on plain forms.
    if (form) {
      try {
        form.requestSubmit();
        results.push('submitted via requestSubmit()');
        return results.join('; ');
      } catch { /* invalid form, fall through */ }
    }

    // 3. Native click on the submit button — fallback for non-form submit patterns.
    if (submitBtn) {
      submitBtn.click();
      results.push('clicked submit button');
      return results.join('; ');
    }

    // 4. form.submit() — last resort, bypasses validation but always works.
    if (form) {
      form.submit();
      results.push('submitted via form.submit()');
      return results.join('; ');
    }

    results.push('no form or submit button found');
  }

  return results.join('; ');
}

async function evaluateScript(script) {
  return await (0, eval)(script);
}

function getPageText() {
  return document.body?.innerText || '';
}

connect().catch(() => {});
