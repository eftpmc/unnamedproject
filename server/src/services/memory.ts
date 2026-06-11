import { getDb, getProjectForUser } from '../db/index.js';
import { newId } from '../lib/ids.js';

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryEntry {
  type: MemoryType;
  key: string;
  value: string;
  project_id: string | null;
}

export function rememberFact(userId: string, type: MemoryType, key: string, value: string, projectId: string | null = null): void {
  const existing = getDb()
    .prepare('SELECT id FROM memories WHERE user_id = ? AND type = ? AND key = ?')
    .get(userId, type, key);
  if (existing) {
    getDb()
      .prepare('UPDATE memories SET value = ?, project_id = ?, updated_at = unixepoch() WHERE user_id = ? AND type = ? AND key = ?')
      .run(value, projectId, userId, type, key);
  } else {
    getDb()
      .prepare('INSERT INTO memories (id, user_id, type, key, value, project_id) VALUES (?,?,?,?,?,?)')
      .run(newId(), userId, type, key, value, projectId);
  }
}

export function recallFact(userId: string, type: MemoryType, key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM memories WHERE user_id = ? AND type = ? AND key = ?')
    .get(userId, type, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function forgetFact(userId: string, type: MemoryType, key: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM memories WHERE user_id = ? AND type = ? AND key = ?')
    .run(userId, type, key);
  return result.changes > 0;
}

export function recallAll(userId: string, type?: MemoryType): MemoryEntry[] {
  const rows = type
    ? getDb().prepare('SELECT type, key, value, project_id FROM memories WHERE user_id = ? AND type = ?').all(userId, type)
    : getDb().prepare('SELECT type, key, value, project_id FROM memories WHERE user_id = ?').all(userId);
  return rows as MemoryEntry[];
}

export function projectNameFor(userId: string, projectId: string | null): string | null {
  if (!projectId) return null;
  return getProjectForUser(projectId, userId)?.name ?? null;
}
