import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { encrypt, decrypt, deriveKey } from '../lib/crypto.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { isPermissionProfile } from '../services/permissions.js';

const router = Router();
router.use(requireAuth);

const VALID_TYPES = ['claude_code'] as const;
type ProviderType = (typeof VALID_TYPES)[number];

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare('SELECT id, name, type, created_at FROM agent_providers WHERE user_id = ? ORDER BY created_at')
    .all(userId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { name, type, config } = req.body as { name?: string; type?: string; config?: Record<string, unknown> };

  if (!name || !type || !config) { res.status(400).json({ error: 'name, type, config required' }); return; }
  if (!VALID_TYPES.includes(type as ProviderType)) {
    res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` }); return;
  }
  if (config.mode !== undefined && config.mode !== 'local' && config.mode !== 'api') {
    res.status(400).json({ error: "mode must be 'local' or 'api'" }); return;
  }
  if (config.mode === 'api' && !config.apiKey) {
    res.status(400).json({ error: "apiKey required when mode is 'api'" }); return;
  }
  if (
    config.permissionProfile !== undefined
    && config.permissionProfile !== 'default'
    && !isPermissionProfile(config.permissionProfile)
  ) {
    res.status(400).json({ error: 'permissionProfile must be default, fast, trusted, strict, or self_modify' }); return;
  }

  const id = newId();
  const encrypted = encrypt(JSON.stringify(config), deriveKey());
  try {
    getDb()
      .prepare('INSERT INTO agent_providers (id, user_id, name, type, encrypted_config) VALUES (?,?,?,?,?)')
      .run(id, userId, name, type, encrypted);
  } catch {
    res.status(409).json({ error: 'Provider name already exists' }); return;
  }
  res.status(201).json({ id, name, type });
});

router.get('/:id/test', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const row = getDb()
    .prepare('SELECT type, encrypted_config FROM agent_providers WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { type: string; encrypted_config: string } | undefined;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }

  const config = JSON.parse(decrypt(row.encrypted_config, deriveKey())) as Record<string, string>;
  if (!config.apiKey) { res.json({ ok: null }); return; }

  const start = Date.now();
  try {
    const client = new Anthropic({ apiKey: config.apiKey });
    await client.models.list();
    res.json({ ok: true, latencyMs: Date.now() - start });
  } catch (err) {
    res.json({ ok: false, error: (err as Error).message, latencyMs: Date.now() - start });
  }
});

router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const result = getDb()
    .prepare('DELETE FROM agent_providers WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);
  if (result.changes === 0) { res.status(404).json({ error: 'Not found' }); return; }
  res.status(204).send();
});

export function getDecryptedProviderConfig(providerId: string, userId: string): Record<string, string> {
  const row = getDb()
    .prepare('SELECT encrypted_config FROM agent_providers WHERE id = ? AND user_id = ?')
    .get(providerId, userId) as { encrypted_config: string } | undefined;
  if (!row) throw new Error(`Agent provider ${providerId} not found`);
  return JSON.parse(decrypt(row.encrypted_config, deriveKey()));
}

export default router;
