import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { embed, cosineSimilarity, bufferToFloat32Array, float32ArrayToBuffer } from './embeddings.js';

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryEntry {
  type: MemoryType;
  key: string;
  value: string;
  project_id: string | null;
}

export function rememberFact(userId: string, type: MemoryType, key: string, value: string, projectId: string | null = null): void {
  getDb()
    .prepare(`
      INSERT INTO memories (id, user_id, type, key, value, project_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, type, key) DO UPDATE SET
        value = excluded.value,
        project_id = excluded.project_id,
        embedding = NULL,
        updated_at = unixepoch()
    `)
    .run(newId(), userId, type, key, value, projectId);

  embed(`${key}: ${value}`).then(vec => {
    getDb()
      .prepare('UPDATE memories SET embedding = ? WHERE user_id = ? AND type = ? AND key = ?')
      .run(float32ArrayToBuffer(vec), userId, type, key);
  }).catch(() => { /* best-effort */ });
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
  const row = getDb()
    .prepare('SELECT name FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId) as { name: string } | undefined;
  return row?.name ?? null;
}

/** @deprecated */
export const spaceNameFor = projectNameFor;

interface MemoryRow extends MemoryEntry {
  embedding: Buffer | null;
}

const MAX_MEMORIES = 20;

export async function recallRelevant(userId: string, queryText: string, pinnedProjectId?: string): Promise<MemoryEntry[]> {
  const rows = getDb()
    .prepare('SELECT type, key, value, project_id, embedding FROM memories WHERE user_id = ?')
    .all(userId) as MemoryRow[];

  if (rows.length === 0) return [];

  const feedback = rows.filter(r => r.type === 'feedback');

  const pinnedProject = pinnedProjectId
    ? rows.filter(r => r.type === 'project' && r.project_id === pinnedProjectId)
    : [];

  const rest = rows.filter(r =>
    r.type !== 'feedback' &&
    !(pinnedProjectId && r.type === 'project' && r.project_id === pinnedProjectId)
  );

  if (rest.length === 0) {
    return dedup([...feedback, ...pinnedProject]);
  }

  try {
    const queryVec = await embed(queryText);

    const scored = rest.map(entry => {
      let score = 0;
      if (entry.embedding) {
        score = cosineSimilarity(queryVec, bufferToFloat32Array(entry.embedding));
      } else {
        const text = `${entry.key} ${entry.value}`.toLowerCase();
        const q = queryText.toLowerCase();
        for (const word of q.split(/\s+/).filter(w => w.length > 3)) {
          if (text.includes(word)) score += 0.1;
        }
      }
      return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const top = scored
      .filter(s => s.score > 0.15)
      .slice(0, MAX_MEMORIES)
      .map(s => s.entry);

    return dedup([...feedback, ...pinnedProject, ...top]);
  } catch {
    return dedup([...feedback, ...pinnedProject, ...rest]);
  }
}

function dedup(entries: MemoryEntry[]): MemoryEntry[] {
  const seen = new Set<string>();
  return entries.filter(e => {
    const k = `${e.type}:${e.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
