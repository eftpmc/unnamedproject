import { getDb, getDueTriggers } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { readFile } from './files.js';
import { markTriggerRun } from './triggers.js';
import { nextCronRun } from '../lib/cron.js';
import { runAgentTurn } from './agent.js';
import { logger } from '../lib/logger.js';

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
    timeout_ms: number | null;
    cost_fresh_threshold_usd: number | null;
  } | undefined;
}

function parsePlaybookMeta(body: string): { model?: string; effort?: string; timeout_ms?: number; cost_fresh_threshold_usd?: number } {
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
  return {
    model: meta.model,
    effort: meta.effort,
    timeout_ms: meta.timeout_ms ? Number(meta.timeout_ms) : undefined,
    cost_fresh_threshold_usd: meta.cost_fresh_threshold_usd ? Number(meta.cost_fresh_threshold_usd) : undefined,
  };
}


export async function fireTrigger(triggerId: string): Promise<string> {
  const trigger = triggerById(triggerId);
  if (!trigger) throw new Error(`Trigger ${triggerId} not found`);

  const playbook = trigger.playbook_id ? await readFile(trigger.playbook_id) : undefined;
  const meta = playbook?.body ? parsePlaybookMeta(playbook.body) : {};
  const effort = meta.effort ?? 'high';
  const model = meta.model ?? null;

  const prompt = playbook
    ? `Run this playbook:\n\n${playbook.body}`
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

  // Playbook frontmatter takes precedence over the trigger's stored limits.
  const turnOpts = {
    timeoutMs: meta.timeout_ms ?? trigger.timeout_ms ?? undefined,
    costFreshThresholdUsd: meta.cost_fresh_threshold_usd ?? trigger.cost_fresh_threshold_usd ?? undefined,
  };

  runAgentTurn(trigger.user_id, sessionId, messageId, turnOpts)
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
      logger.error('[fireTrigger] runAgentTurn failed', { triggerId, err: err instanceof Error ? err.message : String(err) });
    });

  return sessionId;
}

export async function runDueTriggers(): Promise<void> {
  const due = getDueTriggers(Math.floor(Date.now() / 1000));
  await Promise.all(due.map(async t => {
    try { await fireTrigger(t.id); }
    catch (err) { logger.error('[triggers] fireTrigger failed', { triggerId: t.id, err: err instanceof Error ? err.message : String(err) }); }
  }));
}
