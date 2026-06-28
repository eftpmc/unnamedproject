import { getDb, getDueTriggers } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { readDocument } from './documents.js';
import { markTriggerRun } from './triggers.js';
import { nextCronRun } from '../lib/cron.js';
import { runAgentTurn } from './agent.js';

function triggerById(id: string) {
  return getDb().prepare('SELECT t.*, s.user_id FROM triggers t JOIN spaces s ON s.id = t.space_id WHERE t.id = ?')
    .get(id) as { id: string; space_id: string; schedule_cron: string | null; playbook_id: string | null; user_id: string } | undefined;
}

export async function fireTrigger(triggerId: string): Promise<void> {
  const trigger = triggerById(triggerId);
  if (!trigger) throw new Error(`Trigger ${triggerId} not found`);

  const playbook = trigger.playbook_id ? await readDocument(trigger.playbook_id) : undefined;
  const prompt = playbook
    ? `Run this playbook:\n\n${playbook.body}`
    : `Trigger fired. No playbook is set — check the workspace and summarise what has changed since the last run.`;
  const title = `${playbook?.title ?? 'Trigger run'} — ${new Date().toISOString().slice(0, 10)}`;

  const db = getDb();
  const sessionId = newId();
  db.prepare('INSERT INTO sessions (id, user_id, title, pinned_space_id) VALUES (?,?,?,?)')
    .run(sessionId, trigger.user_id, title, trigger.space_id);
  const messageId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
    .run(messageId, sessionId, 'user', prompt);

  const next = trigger.schedule_cron ? nextCronRun(trigger.schedule_cron, Math.floor(Date.now() / 1000)) : null;
  markTriggerRun(trigger.id, next);  // advance schedule (prevents double-fire on restart)

  try {
    await runAgentTurn(trigger.user_id, sessionId, messageId);
  } catch (err) {
    console.error(`[fireTrigger] runAgentTurn failed for trigger ${triggerId}:`, err);
    // Reset next_run_at so the trigger retries next poll instead of being silently skipped
    markTriggerRun(trigger.id, Math.floor(Date.now() / 1000));
  }
}

export async function runDueTriggers(): Promise<void> {
  const due = getDueTriggers(Math.floor(Date.now() / 1000));
  await Promise.all(due.map(async t => {
    try { await fireTrigger(t.id); }
    catch (err) { console.error(`[triggers] ${t.id} failed:`, err); }
  }));
}
