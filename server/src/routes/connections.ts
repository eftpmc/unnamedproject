import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { encrypt, decrypt, deriveKey } from '../lib/crypto.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const VALID_TYPES = ['anthropic', 'openai', 'github', 'mcp', 'local', 'claude_code', 'codex', 'google'] as const;
const VALID_PURPOSES = ['claude_code', 'codex', 'github', 'mcp', 'tool'] as const;

// claude_code and codex are self-describing types — purpose is derived from the type.
// The entries below still guard against manually setting purpose=claude_code/codex on a foreign type.
const PURPOSE_ALLOWED_TYPES: Record<string, string[]> = {
  claude_code: ['claude_code'],
  codex: ['codex'],
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

export class ConnectionValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function createConnectionRecord(
  userId: string,
  input: { name?: string; type?: string; purpose?: string; config?: unknown },
): { id: string; type: string; purpose: string } {
  const { name, type, purpose, config } = input;
  if (!name || !type || !config) {
    throw new ConnectionValidationError('name, type, config required');
  }
  if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
    throw new ConnectionValidationError(`type must be one of ${VALID_TYPES.join(', ')}`);
  }
  // claude_code and codex are self-describing: purpose is derived from the type
  let connectionPurpose: string;
  if (type === 'claude_code' || type === 'codex') {
    connectionPurpose = type;
    const cfg = config as Record<string, unknown>;
    if (cfg.mode !== undefined && cfg.mode !== 'local' && cfg.mode !== 'api') {
      throw new ConnectionValidationError("mode must be 'local' or 'api'");
    }
    if (cfg.mode === 'api' && !cfg.apiKey) {
      throw new ConnectionValidationError("apiKey is required when mode is 'api'");
    }
  } else {
    connectionPurpose = purpose ?? 'tool';
    if (!VALID_PURPOSES.includes(connectionPurpose as (typeof VALID_PURPOSES)[number])) {
      throw new ConnectionValidationError(`purpose must be one of ${VALID_PURPOSES.join(', ')}`);
    }
    const allowedTypes = PURPOSE_ALLOWED_TYPES[connectionPurpose];
    if (allowedTypes && !allowedTypes.includes(type)) {
      throw new ConnectionValidationError(`Purpose '${connectionPurpose}' does not support type '${type}'. Allowed: ${allowedTypes.join(', ')}`);
    }
  }
  const id = newId();
  const encrypted = encrypt(JSON.stringify(config), deriveKey());
  try {
    getDb()
      .prepare('INSERT INTO connections (id, user_id, name, type, purpose, encrypted_config) VALUES (?,?,?,?,?,?)')
      .run(id, userId, name, type, connectionPurpose, encrypted);
  } catch {
    throw new ConnectionValidationError('Connection name already exists', 409);
  }
  return { id, type, purpose: connectionPurpose };
}

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  try {
    const { id, type: connectionType } = createConnectionRecord(userId, req.body as { name?: string; type?: string; purpose?: string; config?: unknown });
    res.status(201).json({ id, type: connectionType });
  } catch (err) {
    if (err instanceof ConnectionValidationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
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
