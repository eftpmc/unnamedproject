import { getDb } from '../db/index.js';

export interface SessionState {
  goal: string | null;
  current_focus: string | null;
  repo_state: string | null;
  facts: string[];
  decisions: string[];
  open_tasks: string[];
  blockers: string[];
  artifacts: string[];
  files_touched: string[];
  verification: string[];
  failed_attempts: string[];
  handoff_notes: string[];
  next_action: string | null;
  updated_at: number;
}

const MAX_ITEMS = 12;
const MAX_ITEM_CHARS = 220;

function emptyState(): SessionState {
  return {
    goal: null,
    current_focus: null,
    repo_state: null,
    facts: [],
    decisions: [],
    open_tasks: [],
    blockers: [],
    artifacts: [],
    files_touched: [],
    verification: [],
    failed_attempts: [],
    handoff_notes: [],
    next_action: null,
    updated_at: Math.floor(Date.now() / 1000),
  };
}

function normalizeItem(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_CHARS);
}

function pushUnique(list: string[], value: string): string[] {
  const normalized = normalizeItem(value);
  if (!normalized) return list;
  const existing = new Set(list.map(v => v.toLowerCase()));
  if (existing.has(normalized.toLowerCase())) return list;
  return [...list, normalized].slice(-MAX_ITEMS);
}

function parseState(raw: string | null): SessionState {
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    return {
      ...emptyState(),
      ...parsed,
      facts: Array.isArray(parsed.facts) ? parsed.facts.map(normalizeItem).filter(Boolean).slice(-MAX_ITEMS) : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(normalizeItem).filter(Boolean).slice(-MAX_ITEMS) : [],
      open_tasks: Array.isArray(parsed.open_tasks) ? parsed.open_tasks.map(normalizeItem).filter(Boolean).slice(-MAX_ITEMS) : [],
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers.map(normalizeItem).filter(Boolean).slice(-MAX_ITEMS) : [],
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts.map(normalizeItem).filter(Boolean).slice(-MAX_ITEMS) : [],
      files_touched: Array.isArray(parsed.files_touched) ? parsed.files_touched.map(normalizeItem).filter(Boolean).slice(-MAX_ITEMS) : [],
      verification: Array.isArray(parsed.verification) ? parsed.verification.map(normalizeItem).filter(Boolean).slice(-MAX_ITEMS) : [],
      failed_attempts: Array.isArray(parsed.failed_attempts) ? parsed.failed_attempts.map(normalizeItem).filter(Boolean).slice(-MAX_ITEMS) : [],
      handoff_notes: Array.isArray(parsed.handoff_notes) ? parsed.handoff_notes.map(normalizeItem).filter(Boolean).slice(-MAX_ITEMS) : [],
      goal: parsed.goal ? normalizeItem(parsed.goal) : null,
      current_focus: parsed.current_focus ? normalizeItem(parsed.current_focus) : null,
      repo_state: parsed.repo_state ? normalizeItem(parsed.repo_state) : null,
      next_action: parsed.next_action ? normalizeItem(parsed.next_action) : null,
      updated_at: typeof parsed.updated_at === 'number' ? parsed.updated_at : Math.floor(Date.now() / 1000),
    };
  } catch {
    return emptyState();
  }
}

function firstSentence(text: string): string {
  const cleaned = normalizeItem(text);
  return cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
}

function extractArtifacts(text: string): string[] {
  const artifacts = new Set<string>();
  const codeMatches = text.matchAll(/`([^`\n]+\.(?:md|txt|json|ts|tsx|js|jsx|swift|py|css|html|yml|yaml))`/gi);
  for (const match of codeMatches) artifacts.add(match[1]);
  const bareMatches = text.matchAll(/\b[\w./-]+\.(?:md|txt|json|ts|tsx|js|jsx|swift|py|css|html|yml|yaml)\b/gi);
  for (const match of bareMatches) artifacts.add(match[0]);
  return [...artifacts].slice(0, 6);
}

function extractFilesTouched(text: string): string[] {
  const files = new Set<string>();
  const patterns = [
    /\b(?:modified|updated|created|added|edited|changed|touched|patched)\s+`([^`\n]+\.[A-Za-z0-9]+)`/gi,
    /\b(?:modified|updated|created|added|edited|changed|touched|patched)\s+([\w./-]+\.[A-Za-z0-9]+)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) files.add(match[1]);
  }
  for (const artifact of extractArtifacts(text)) files.add(artifact);
  return [...files].slice(0, 8);
}

function extractVerification(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map(normalizeItem)
    .filter(Boolean);
  const verified = lines.filter(line => /\b(test|tests|build|typecheck|lint|verified|passed|green|failed)\b/i.test(line));
  return verified.slice(-4);
}

function extractRepoState(text: string): string | null {
  const sentences = normalizeItem(text).split(/(?<=[.!?])\s+/).filter(Boolean);
  for (const sentence of sentences) {
    if (/\b(uncommitted|git status|working tree|worktree|modified files|staged|committed|commit)\b/i.test(sentence)) {
      return sentence;
    }
  }
  return null;
}

function extractSignalSentence(text: string, pattern: RegExp): string | null {
  const sentences = normalizeItem(text).split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.find(sentence => pattern.test(sentence)) ?? null;
}

function browserFailureSignature(text: string): string | null {
  const lower = text.toLowerCase();
  const isBrowserFailure = (
    lower.includes('same screen') ||
    lower.includes('no navigation') ||
    lower.includes('nothing happens') ||
    lower.includes("didn't progress") ||
    lower.includes('did not progress') ||
    lower.includes('still on') ||
    lower.includes('click reports success') ||
    lower.includes('button did not trigger') ||
    lower.includes('login') && (lower.includes('stuck') || lower.includes('failed'))
  );
  if (!isBrowserFailure) return null;

  if (lower.includes('password')) return 'browser login/password action did not progress';
  if (lower.includes('login')) return 'browser login action did not progress';
  if (lower.includes('click')) return 'browser click action reported success without progress';
  return 'browser automation action did not progress';
}

function countOccurrences(items: string[], value: string): number {
  const needle = value.toLowerCase();
  return items.filter(item => item.toLowerCase() === needle).length;
}

function updateFromTurn(state: SessionState, userText: string, assistantText: string): SessionState {
  let next: SessionState = { ...state, updated_at: Math.floor(Date.now() / 1000) };
  if (!next.goal && userText.trim()) next.goal = firstSentence(userText);
  if (userText.trim()) next.current_focus = firstSentence(userText);

  const assistant = assistantText.trim();
  if (!assistant) return next;

  if (/\b(done|created|updated|implemented|fixed|confirmed|verified|added)\b/i.test(assistant)) {
    next.facts = pushUnique(next.facts, firstSentence(assistant));
  }
  if (/\b(decided|will|should|plan|next step|recommend)\b/i.test(assistant)) {
    next.decisions = pushUnique(next.decisions, firstSentence(assistant));
  }
  if (/\b(blocked|stuck|can't|cannot|failed|error|limit|needs? approval|manual)\b/i.test(assistant)) {
    next.blockers = pushUnique(next.blockers, firstSentence(assistant));
  }
  if (/\b(failed|didn't|did not|same screen|no navigation|error)\b/i.test(assistant)) {
    next.failed_attempts = pushUnique(next.failed_attempts, firstSentence(assistant));
  }
  const browserSignature = browserFailureSignature(assistant);
  if (browserSignature) {
    const alreadySeen = countOccurrences(next.failed_attempts, browserSignature);
    next.failed_attempts = pushUnique(next.failed_attempts, browserSignature);
    if (alreadySeen >= 1) {
      next.blockers = pushUnique(next.blockers, `${browserSignature} repeatedly. Do not retry the same browser action; switch strategy or ask for manual intervention.`);
      next.next_action = 'Switch browser automation strategy or ask the user for manual intervention.';
    }
  }
  if (/\b(todo|still|remaining|next|continue|follow[- ]?up)\b/i.test(assistant)) {
    next.open_tasks = pushUnique(next.open_tasks, firstSentence(assistant));
    next.next_action = firstSentence(assistant);
  }
  for (const artifact of extractArtifacts(assistant)) {
    next.artifacts = pushUnique(next.artifacts, artifact);
  }
  for (const file of extractFilesTouched(assistant)) {
    next.files_touched = pushUnique(next.files_touched, file);
  }
  for (const check of extractVerification(assistant)) {
    next.verification = pushUnique(next.verification, check);
  }
  const repoState = extractRepoState(assistant);
  if (repoState) next.repo_state = repoState;
  const handoff = extractSignalSentence(assistant, /\b(handoff|checkpoint|continue from|fresh provider|start fresh|resume)\b/i);
  if (handoff) {
    next.handoff_notes = pushUnique(next.handoff_notes, handoff);
  }

  return next;
}

export function getSessionState(sessionId: string): SessionState {
  const row = getDb()
    .prepare('SELECT session_state FROM sessions WHERE id = ?')
    .get(sessionId) as { session_state: string | null } | undefined;
  return parseState(row?.session_state ?? null);
}

export function updateSessionState(sessionId: string): SessionState {
  const state = getSessionState(sessionId);
  const messages = getDb()
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 10')
    .all(sessionId) as { role: 'user' | 'assistant'; content: string }[];

  let next = state;
  const ordered = [...messages].reverse();
  for (let i = 0; i < ordered.length - 1; i++) {
    const current = ordered[i];
    const following = ordered[i + 1];
    if (current.role === 'user' && following.role === 'assistant') {
      next = updateFromTurn(next, current.content, following.content);
      i++;
    }
  }

  getDb()
    .prepare('UPDATE sessions SET session_state = ? WHERE id = ?')
    .run(JSON.stringify(next), sessionId);
  return next;
}

export function recordSessionStateEvent(
  sessionId: string,
  event: Partial<Pick<SessionState, 'goal' | 'next_action'>> & {
    current_focus?: string | null;
    repo_state?: string | null;
    facts?: string[];
    decisions?: string[];
    open_tasks?: string[];
    blockers?: string[];
    artifacts?: string[];
    files_touched?: string[];
    verification?: string[];
    failed_attempts?: string[];
    handoff_notes?: string[];
  },
): SessionState {
  let next = getSessionState(sessionId);
  if (event.goal) next.goal = normalizeItem(event.goal);
  if (event.current_focus) next.current_focus = normalizeItem(event.current_focus);
  if (event.repo_state) next.repo_state = normalizeItem(event.repo_state);
  if (event.next_action) next.next_action = normalizeItem(event.next_action);
  for (const item of event.facts ?? []) next.facts = pushUnique(next.facts, item);
  for (const item of event.decisions ?? []) next.decisions = pushUnique(next.decisions, item);
  for (const item of event.open_tasks ?? []) next.open_tasks = pushUnique(next.open_tasks, item);
  for (const item of event.blockers ?? []) next.blockers = pushUnique(next.blockers, item);
  for (const item of event.artifacts ?? []) next.artifacts = pushUnique(next.artifacts, item);
  for (const item of event.files_touched ?? []) next.files_touched = pushUnique(next.files_touched, item);
  for (const item of event.verification ?? []) next.verification = pushUnique(next.verification, item);
  for (const item of event.failed_attempts ?? []) next.failed_attempts = pushUnique(next.failed_attempts, item);
  for (const item of event.handoff_notes ?? []) next.handoff_notes = pushUnique(next.handoff_notes, item);
  next = { ...next, updated_at: Math.floor(Date.now() / 1000) };
  getDb()
    .prepare('UPDATE sessions SET session_state = ? WHERE id = ?')
    .run(JSON.stringify(next), sessionId);
  return next;
}

function listBlock(label: string, items: string[]): string {
  if (items.length === 0) return '';
  return `${label}:\n${items.map(item => `- ${item}`).join('\n')}`;
}

export function formatSessionStateBlock(sessionId: string): string {
  const state = getSessionState(sessionId);
  const blocks = [
    state.goal ? `Goal: ${state.goal}` : '',
    state.current_focus ? `Current focus: ${state.current_focus}` : '',
    state.repo_state ? `Repo/workspace state: ${state.repo_state}` : '',
    listBlock('Facts', state.facts),
    listBlock('Decisions', state.decisions),
    listBlock('Open tasks', state.open_tasks),
    listBlock('Blockers', state.blockers),
    listBlock('Artifacts', state.artifacts),
    listBlock('Files touched', state.files_touched),
    listBlock('Verification', state.verification),
    listBlock('Failed attempts', state.failed_attempts),
    listBlock('Handoff notes', state.handoff_notes),
    state.next_action ? `Next action: ${state.next_action}` : '',
  ].filter(Boolean);

  if (blocks.length === 0) return '';
  return `Structured session state:\n${blocks.join('\n\n')}`;
}
