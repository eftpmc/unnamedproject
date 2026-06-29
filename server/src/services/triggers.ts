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
}

export function createTrigger(input: {
  project_id: string;
  kind: 'schedule' | 'webhook' | 'manual';
  schedule_cron?: string | null;
  playbook_id?: string | null;
  next_run_at?: number | null;
}): TriggerRecord {
  const rec: TriggerRecord = {
    id: newId(), project_id: input.project_id, kind: input.kind,
    schedule_cron: input.schedule_cron ?? null, playbook_id: input.playbook_id ?? null,
    enabled: 1, next_run_at: input.next_run_at ?? null, last_run_at: null,
    created_at: Math.floor(Date.now() / 1000),
  };
  getDb().prepare(
    'INSERT INTO triggers (id,project_id,kind,schedule_cron,playbook_id,enabled,next_run_at,last_run_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(rec.id, rec.project_id, rec.kind, rec.schedule_cron, rec.playbook_id, rec.enabled, rec.next_run_at, rec.last_run_at, rec.created_at);
  return getDb().prepare('SELECT * FROM triggers WHERE id = ?').get(rec.id) as TriggerRecord;
}

export function listTriggersByUser(userId: string): TriggerRecord[] {
  return getDb().prepare(`
    SELECT t.* FROM triggers t
    JOIN projects p ON p.id = t.project_id
    WHERE p.user_id = ?
    ORDER BY t.created_at DESC
  `).all(userId) as TriggerRecord[];
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
