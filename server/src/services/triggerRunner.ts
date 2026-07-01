import fs from 'fs';
import path from 'path';
import { getDb, getDueTriggers } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { readFile } from './files.js';
import { markTriggerRun } from './triggers.js';
import { nextCronRun } from '../lib/cron.js';
import { runAgentTurn } from './agent.js';

function triggerById(id: string) {
  return getDb().prepare(`
    SELECT t.*, p.user_id, p.files_path
    FROM triggers t
    JOIN projects p ON p.id = t.project_id
    WHERE t.id = ?
  `).get(id) as {
    id: string;
    project_id: string;
    schedule_cron: string | null;
    playbook_id: string | null;
    user_id: string;
    files_path: string;
    last_provider_session_id: string | null;
  } | undefined;
}

function parsePlaybookMeta(body: string): { model?: string; effort?: string } {
  const match = body.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const k = line.slice(0, colon).trim();
    const v = line.slice(colon + 1).trim();
    if (k && v) meta[k] = v;
  }
  return { model: meta.model, effort: meta.effort };
}

// Read the last N "Queries run this session" blocks from the opportunity log
// so the agent knows what to skip without re-reading the whole file.
function extractRecentQueryBlocks(filesPath: string, n = 3): string | null {
  const logPath = path.join(filesPath, 'opportunity-log.md');
  let raw: string;
  try { raw = fs.readFileSync(logPath, 'utf-8'); } catch { return null; }

  const blocks: string[] = [];
  const lines = raw.split('\n');
  let capturing = false;
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (capturing && current.length) { blocks.push(current.join('\n').trim()); current = []; }
      capturing = true;
    }
    if (capturing) {
      if (line.startsWith('**Queries run this session:**') || line.startsWith('**Search coverage')) {
        current.push(line);
      } else if (current.length) {
        if (line.startsWith('**') && !line.startsWith('**Queries')) { capturing = false; continue; }
        current.push(line);
      }
    }
  }
  if (capturing && current.length) blocks.push(current.join('\n').trim());

  const recent = blocks.filter(Boolean).slice(-n);
  if (!recent.length) return null;
  return `<recent_queries>\nThe following queries and company checks were run in recent sessions. Skip duplicates — rotate to different terms and companies.\n\n${recent.join('\n\n')}\n</recent_queries>`;
}

export async function fireTrigger(triggerId: string): Promise<string> {
  const trigger = triggerById(triggerId);
  if (!trigger) throw new Error(`Trigger ${triggerId} not found`);

  const playbook = trigger.playbook_id ? await readFile(trigger.playbook_id) : undefined;
  const meta = playbook?.body ? parsePlaybookMeta(playbook.body) : {};
  const effort = meta.effort ?? 'high';
  const model = meta.model ?? null;

  const recentQueries = trigger.files_path ? extractRecentQueryBlocks(trigger.files_path) : null;

  const prompt = playbook
    ? `${recentQueries ? recentQueries + '\n\n' : ''}Run this playbook:\n\n${playbook.body}`
    : `Trigger fired. No playbook is set — check the workspace and summarise what has changed since the last run.`;

  const title = `${playbook?.title ?? 'Trigger run'} — ${new Date().toISOString().slice(0, 10)}`;

  const db = getDb();
  const sessionId = newId();
  db.prepare('INSERT INTO sessions (id, user_id, title, pinned_project_id, effort, model, trigger_id, provider_session_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(sessionId, trigger.user_id, title, trigger.project_id, effort, model, trigger.id, trigger.last_provider_session_id ?? null);
  const messageId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
    .run(messageId, sessionId, 'user', prompt);

  const next = trigger.schedule_cron ? nextCronRun(trigger.schedule_cron, Math.floor(Date.now() / 1000)) : null;
  markTriggerRun(trigger.id, next);

  runAgentTurn(trigger.user_id, sessionId, messageId)
    .then(() => {
      // Persist the Claude Code session ID so the next trigger run can resume it.
      const sess = db.prepare('SELECT provider_session_id FROM sessions WHERE id = ?')
        .get(sessionId) as { provider_session_id: string | null } | undefined;
      if (sess?.provider_session_id) {
        db.prepare('UPDATE triggers SET last_provider_session_id = ? WHERE id = ?')
          .run(sess.provider_session_id, trigger.id);
      }
    })
    .catch(err => {
      console.error(`[fireTrigger] runAgentTurn failed for trigger ${triggerId}:`, err);
      markTriggerRun(trigger.id, Math.floor(Date.now() / 1000));
    });

  return sessionId;
}

export async function runDueTriggers(): Promise<void> {
  const due = getDueTriggers(Math.floor(Date.now() / 1000));
  await Promise.all(due.map(async t => {
    try { await fireTrigger(t.id); }
    catch (err) { console.error(`[triggers] ${t.id} failed:`, err); }
  }));
}
