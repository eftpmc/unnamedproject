import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { encrypt, decrypt, deriveKey } from '../lib/crypto.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const VALID_TYPES = ['anthropic', 'openai', 'github', 'mcp'] as const;

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare('SELECT id, name, type, created_at FROM connections WHERE user_id = ? ORDER BY created_at')
    .all(userId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { name, type, config } = req.body as { name?: string; type?: string; config?: unknown };
  if (!name || !type || !config) {
    res.status(400).json({ error: 'name, type, config required' });
    return;
  }
  if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
    res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` });
    return;
  }
  const id = newId();
  const encrypted = encrypt(JSON.stringify(config), deriveKey());
  try {
    getDb()
      .prepare('INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES (?,?,?,?,?)')
      .run(id, userId, name, type, encrypted);
  } catch {
    res.status(409).json({ error: 'Connection name already exists' });
    return;
  }
  res.status(201).json({ id });
});

router.delete('/:id', (req, res) => {
  const { userId } = req as AuthedRequest;
  const result = getDb()
    .prepare('DELETE FROM connections WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(204).send();
});

export function getDecryptedConfig(connectionId: string): Record<string, string> {
  const row = getDb()
    .prepare('SELECT encrypted_config FROM connections WHERE id = ?')
    .get(connectionId) as { encrypted_config: string } | undefined;
  if (!row) throw new Error(`Connection ${connectionId} not found`);
  return JSON.parse(decrypt(row.encrypted_config, deriveKey()));
}

export default router;
