import { Router } from 'express';
import { getDb } from '../db/index.js';
import { encrypt, decrypt, deriveKey } from '../lib/crypto.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare('SELECT key, updated_at FROM vault_entries WHERE user_id = ? ORDER BY key')
    .all(userId) as { key: string; updated_at: number }[];
  res.json(rows);
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { key, value } = req.body as { key?: string; value?: string };
  if (!key?.trim() || !value) {
    res.status(400).json({ error: 'key and value are required' });
    return;
  }
  const normalKey = key.trim().toLowerCase();
  const encrypted = encrypt(value, deriveKey());
  getDb()
    .prepare(`
      INSERT INTO vault_entries (id, user_id, key, encrypted_value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = unixepoch()
    `)
    .run(newId(), userId, normalKey, encrypted);
  res.json({ key: normalKey });
});

router.post('/import', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { entries } = req.body as { entries?: { key: string; value: string }[] };
  if (!Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ error: 'entries array is required' });
    return;
  }
  const key = deriveKey();
  const insert = getDb().prepare(`
    INSERT INTO vault_entries (id, user_id, key, encrypted_value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = unixepoch()
  `);
  let imported = 0;
  const importMany = getDb().transaction(() => {
    for (const entry of entries) {
      if (!entry.key?.trim() || !entry.value) continue;
      insert.run(newId(), userId, entry.key.trim().toLowerCase(), encrypt(entry.value, key));
      imported++;
    }
  });
  importMany();
  res.json({ imported });
});

router.delete('/:key', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { key } = req.params;
  const result = getDb()
    .prepare('DELETE FROM vault_entries WHERE user_id = ? AND key = ?')
    .run(userId, key);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(204).end();
});

export default router;
