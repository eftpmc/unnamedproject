import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';

export interface TriggerRecord {
  id: string;
  project_id: string;
  kind: 'schedule' | 'webhook' | 'manual';
  schedule_cron: string | null;
  playbook_id: string | null;
  enabled: number;
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
  last_provider_session_id: string | null;
  total_cost_usd: number;
  last_run_status: 'running' | 'done' | 'error' | null;
  timeout_ms: number | null;
  cost_fresh_threshold_usd: number | null;
}

export interface TriggerRun {
  id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  cost_usd: number;
  status: 'running' | 'done' | 'error' | null;
}

export function createTrigger(input: {
  project_id: string;
  kind: 'schedule' | 'webhook' | 'manual';
  schedule_cron?: string | null;
  playbook_id?: string | null;
  next_run_at?: number | null;
  timeout_ms?: number | null;
  cost_fresh_threshold_usd?: number | null;
}): TriggerRecord {
  const id = newId();
  getDb().prepare(
    'INSERT INTO triggers (id,project_id,kind,schedule_cron,playbook_id,enabled,next_run_at,last_run_at,created_at,timeout_ms,cost_fresh_threshold_usd) VALUES (?,?,?,?,?,1,?,NULL,unixepoch(),?,?)',
  ).run(id, input.project_id, input.kind, input.schedule_cron ?? null, input.playbook_id ?? null, input.next_run_at ?? null, input.timeout_ms ?? null, input.cost_fresh_threshold_usd ?? null);
  return getDb().prepare('SELECT * FROM triggers WHERE id = ?').get(id) as TriggerRecord;
}

export function listTriggersByUser(userId: string): TriggerRecord[] {
  return getDb().prepare(`
    SELECT t.*,
      COALESCE((
        SELECT SUM(au.cost_usd) FROM agent_usage au
        JOIN sessions s ON s.id = au.session_id
        WHERE s.trigger_id = t.id
      ), 0) as total_cost_usd,
      (
        SELECT st.status FROM session_turns st
        JOIN sessions s ON s.id = st.session_id
        WHERE s.trigger_id = t.id
        ORDER BY st.started_at DESC LIMIT 1
      ) as last_run_status
    FROM triggers t
    JOIN projects p ON p.id = t.project_id
    WHERE p.user_id = ?
    ORDER BY t.created_at DESC
  `).all(userId) as TriggerRecord[];
}

export function listTriggerRuns(triggerId: string, limit = 20): TriggerRun[] {
  return getDb().prepare(`
    SELECT s.id, s.title, s.created_at, s.updated_at,
      COALESCE((SELECT SUM(cost_usd) FROM agent_usage WHERE session_id = s.id), 0) as cost_usd,
      (SELECT st.status FROM session_turns st WHERE st.session_id = s.id ORDER BY st.started_at DESC LIMIT 1) as status
    FROM sessions s
    WHERE s.trigger_id = ?
    ORDER BY s.created_at DESC
    LIMIT ?
  `).all(triggerId, limit) as TriggerRun[];
}

export function listTriggersByProject(projectId: string, userId: string): TriggerRecord[] {
  return getDb().prepare(`
    SELECT t.* FROM triggers t
    JOIN projects p ON p.id = t.project_id
    WHERE t.project_id = ? AND p.user_id = ?
    ORDER BY t.created_at DESC
  `).all(projectId, userId) as TriggerRecord[];
}

export function getTrigger(triggerId: string): TriggerRecord | undefined {
  return getDb().prepare('SELECT * FROM triggers WHERE id = ?').get(triggerId) as TriggerRecord | undefined;
}

export function setTriggerEnabled(id: string, enabled: boolean): boolean {
  return getDb().prepare('UPDATE triggers SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id).changes > 0;
}

export function markTriggerRun(id: string, nextRunAt: number | null): void {
  getDb().prepare('UPDATE triggers SET last_run_at = unixepoch(), next_run_at = ? WHERE id = ?').run(nextRunAt, id);
}

export function deleteTrigger(id: string): boolean {
  return getDb().prepare('DELETE FROM triggers WHERE id = ?').run(id).changes > 0;
}
