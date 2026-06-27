import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';

export interface TriggerRecord {
  id: string;
  space_id: string;
  kind: 'schedule' | 'webhook' | 'manual';
  schedule_cron: string | null;
  playbook_id: string | null;
  enabled: number;
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
}

export function createTrigger(input: {
  space_id: string;
  kind: 'schedule' | 'webhook' | 'manual';
  schedule_cron?: string | null;
  playbook_id?: string | null;
  next_run_at?: number | null;
}): TriggerRecord {
  const rec: TriggerRecord = {
    id: newId(), space_id: input.space_id, kind: input.kind,
    schedule_cron: input.schedule_cron ?? null, playbook_id: input.playbook_id ?? null,
    enabled: 1, next_run_at: input.next_run_at ?? null, last_run_at: null,
    created_at: Math.floor(Date.now() / 1000),
  };
  getDb().prepare(
    'INSERT INTO triggers (id,space_id,kind,schedule_cron,playbook_id,enabled,next_run_at,last_run_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(rec.id, rec.space_id, rec.kind, rec.schedule_cron, rec.playbook_id, rec.enabled, rec.next_run_at, rec.last_run_at, rec.created_at);
  return rec;
}

export function listTriggers(spaceId: string): TriggerRecord[] {
  return getDb().prepare('SELECT * FROM triggers WHERE space_id = ? ORDER BY created_at DESC').all(spaceId) as TriggerRecord[];
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
