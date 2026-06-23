import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { encrypt, decrypt, deriveKey } from '../lib/crypto.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { ingestMcpTools } from '../services/toolRegistry.js';

const router = Router();
router.use(requireAuth);

const VALID_TYPES = ['anthropic', 'openai', 'github', 'mcp', 'local'] as const;
const VALID_PURPOSES = ['lead_agent', 'claude_code', 'codex', 'github', 'mcp', 'tool'] as const;

// For most purposes exactly one type is valid. lead_agent accepts all three provider types.
const PURPOSE_ALLOWED_TYPES: Record<string, string[]> = {
  lead_agent: ['anthropic', 'openai', 'local'],
  claude_code: ['anthropic'],
  codex: ['openai'],
  github: ['github'],
  mcp: ['mcp'],
};

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare('SELECT id, name, type, purpose, created_at FROM connections WHERE user_id = ? ORDER BY created_at')
    .all(userId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { name, type, purpose, config } = req.body as { name?: string; type?: string; purpose?: string; config?: unknown };
  if (!name || !type || !config) {
    res.status(400).json({ error: 'name, type, config required' });
    return;
  }
  if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
    res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` });
    return;
  }
  const connectionPurpose = purpose ?? 'tool';
  if (!VALID_PURPOSES.includes(connectionPurpose as (typeof VALID_PURPOSES)[number])) {
    res.status(400).json({ error: `purpose must be one of ${VALID_PURPOSES.join(', ')}` });
    return;
  }
  const allowedTypes = PURPOSE_ALLOWED_TYPES[connectionPurpose];
  if (allowedTypes && !allowedTypes.includes(type)) {
    res.status(400).json({ error: `Purpose '${connectionPurpose}' does not support type '${type}'. Allowed: ${allowedTypes.join(', ')}` });
    return;
  }
  // Validate required config fields for lead_agent non-anthropic providers
  if (connectionPurpose === 'lead_agent' && type === 'openai') {
    const cfg = config as Record<string, unknown>;
    if (!cfg.modelName || typeof cfg.modelName !== 'string') {
      res.status(400).json({ error: "OpenAI lead agent connection requires 'modelName' in config (e.g. 'gpt-4o')" });
      return;
    }
  }
  if (connectionPurpose === 'lead_agent' && type === 'local') {
    const cfg = config as Record<string, unknown>;
    if (!cfg.baseUrl || typeof cfg.baseUrl !== 'string') {
      res.status(400).json({ error: "Local lead agent connection requires 'baseUrl' in config (e.g. 'http://localhost:11434/v1')" });
      return;
    }
    if (!cfg.modelName || typeof cfg.modelName !== 'string') {
      res.status(400).json({ error: "Local lead agent connection requires 'modelName' in config (e.g. 'qwen2.5:14b')" });
      return;
    }
  }
  const id = newId();
  const encrypted = encrypt(JSON.stringify(config), deriveKey());
  try {
    getDb()
      .prepare('INSERT INTO connections (id, user_id, name, type, purpose, encrypted_config) VALUES (?,?,?,?,?,?)')
      .run(id, userId, name, type, connectionPurpose, encrypted);
  } catch {
    res.status(409).json({ error: 'Connection name already exists' });
    return;
  }
  res.status(201).json({ id });
  if (type === 'mcp') {
    ingestMcpTools(userId, id).catch(() => {});
  }
});

router.get('/:id/test', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const row = getDb()
    .prepare('SELECT type, purpose, encrypted_config FROM connections WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { type: string; purpose: string; encrypted_config: string } | undefined;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }

  const start = Date.now();

  try {
    const config = JSON.parse(decrypt(row.encrypted_config, deriveKey())) as Record<string, string>;
    const usesLocalCliAuth = !config.apiKey && (row.purpose === 'claude_code' || row.purpose === 'codex');
    if (usesLocalCliAuth) {
      res.json({ ok: null }); // relies on local `claude`/`codex` CLI subscription login — not testable via HTTP
      return;
    }
    if (row.type === 'anthropic') {
      const client = new Anthropic({ apiKey: config.apiKey });
      await client.models.list();
    } else if (row.type === 'openai') {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } else if (row.type === 'github') {
      const r = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${config.apiKey}`, 'User-Agent': 'unnamed-app' },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } else if (row.type === 'local') {
      const baseUrl = config.baseUrl?.replace(/\/$/, '');
      if (!baseUrl) throw new Error('Missing baseUrl in local connection config');
      const headers: Record<string, string> = {};
      if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
      const r = await fetch(`${baseUrl}/models`, { headers });
      // Local servers (Ollama, LM Studio) may return 401 without a key — that still
      // means the server is reachable, which is what the test cares about.
      if (!r.ok && r.status !== 401) throw new Error(`HTTP ${r.status}`);
    } else {
      res.json({ ok: null }); // MCP — not testable via HTTP
      return;
    }
    res.json({ ok: true, latencyMs: Date.now() - start });
  } catch (err) {
    res.json({ ok: false, error: (err as Error).message, latencyMs: Date.now() - start });
  }
});

router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const result = getDb()
    .prepare('DELETE FROM connections WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(204).send();
});

export function getDecryptedConfig(connectionId: string, userId: string): Record<string, string> {
  const row = getDb()
    .prepare('SELECT encrypted_config FROM connections WHERE id = ? AND user_id = ?')
    .get(connectionId, userId) as { encrypted_config: string } | undefined;
  if (!row) throw new Error(`Connection ${connectionId} not found`);
  return JSON.parse(decrypt(row.encrypted_config, deriveKey()));
}

export default router;
