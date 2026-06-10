import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';

export function rememberFact(userId: string, key: string, value: string): void {
  const existing = getDb()
    .prepare('SELECT id FROM user_memory WHERE user_id = ? AND key = ?')
    .get(userId, key);
  if (existing) {
    getDb()
      .prepare('UPDATE user_memory SET value = ?, updated_at = unixepoch() WHERE user_id = ? AND key = ?')
      .run(value, userId, key);
  } else {
    getDb()
      .prepare('INSERT INTO user_memory (id, user_id, key, value) VALUES (?,?,?,?)')
      .run(newId(), userId, key, value);
  }
}

export function recallFact(userId: string, key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM user_memory WHERE user_id = ? AND key = ?')
    .get(userId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function recallAll(userId: string): Record<string, string> {
  const rows = getDb()
    .prepare('SELECT key, value FROM user_memory WHERE user_id = ?')
    .all(userId) as { key: string; value: string }[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
