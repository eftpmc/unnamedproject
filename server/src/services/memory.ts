import { getDb, getProjectForUser } from '../db/index.js';
import { newId } from '../lib/ids.js';
import type { Intent } from './intent.js';

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

const MAX_USER_MEMORIES = 10;

function scoreMemory(entry: MemoryEntry, intent: Intent): number {
  const text = `${entry.key} ${entry.value}`.toLowerCase();
  let score = 0;
  if (text.includes(intent.domain)) score += 2;
  for (const tool of intent.tools) {
    const normalized = tool.toLowerCase().replace(/_/g, ' ');
    if (text.includes(normalized) || text.includes(tool.toLowerCase())) score += 1;
  }
  return score;
}

export function recallRelevant(userId: string, intent: Intent, pinnedProjectId?: string): MemoryEntry[] {
  const all = recallAll(userId);

  const feedback = all.filter(e => e.type === 'feedback');

  const project = pinnedProjectId
    ? all.filter(e => e.type === 'project' && e.project_id === pinnedProjectId)
    : all.filter(e => e.type === 'project' && scoreMemory(e, intent) > 0);

  const reference = intent.domain === 'general'
    ? all.filter(e => e.type === 'reference')
    : all.filter(e => e.type === 'reference' && scoreMemory(e, intent) > 0);

  const user = all
    .filter(e => e.type === 'user')
    .map(e => ({ entry: e, score: scoreMemory(e, intent) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_USER_MEMORIES)
    .map(s => s.entry);

  return [...feedback, ...project, ...reference, ...user];
}
