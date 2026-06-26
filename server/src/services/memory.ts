import { getDb, getSpaceForUser } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { embed, cosineSimilarity, bufferToFloat32Array, float32ArrayToBuffer } from './embeddings.js';

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryEntry {
  type: MemoryType;
  key: string;
  value: string;
  space_id: string | null;
}

export function rememberFact(userId: string, type: MemoryType, key: string, value: string, spaceId: string | null = null): void {
  getDb()
    .prepare(`
      INSERT INTO memories (id, user_id, type, key, value, space_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, type, key) DO UPDATE SET
        value = excluded.value,
        space_id = excluded.space_id,
        embedding = NULL,
        updated_at = unixepoch()
    `)
    .run(newId(), userId, type, key, value, spaceId);

  // Generate and store embedding async (fire-and-forget)
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
    ? getDb().prepare('SELECT type, key, value, space_id FROM memories WHERE user_id = ? AND type = ?').all(userId, type)
    : getDb().prepare('SELECT type, key, value, space_id FROM memories WHERE user_id = ?').all(userId);
  return rows as MemoryEntry[];
}

export function spaceNameFor(userId: string, spaceId: string | null): string | null {
  if (!spaceId) return null;
  return getSpaceForUser(spaceId, userId)?.name ?? null;
}

/** @deprecated Use spaceNameFor */
export const projectNameFor = spaceNameFor;

interface MemoryRow extends MemoryEntry {
  embedding: Buffer | null;
}

const MAX_MEMORIES = 20;

export async function recallRelevant(userId: string, queryText: string, pinnedSpaceId?: string): Promise<MemoryEntry[]> {
  const rows = getDb()
    .prepare('SELECT type, key, value, space_id, embedding FROM memories WHERE user_id = ?')
    .all(userId) as MemoryRow[];

  if (rows.length === 0) return [];

  // Always include all feedback
  const feedback = rows.filter(r => r.type === 'feedback');

  // Always include project memories for the pinned space
  const pinnedProject = pinnedSpaceId
    ? rows.filter(r => r.type === 'project' && r.space_id === pinnedSpaceId)
    : [];

  // Semantic scoring for the rest
  const rest = rows.filter(r =>
    r.type !== 'feedback' &&
    !(pinnedSpaceId && r.type === 'project' && r.space_id === pinnedSpaceId)
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
        // Keyword fallback for entries without embeddings yet
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
    // If embedding fails, return everything (old behavior)
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
