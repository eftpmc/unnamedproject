import { Router } from 'express';
import { google } from 'googleapis';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { encrypt, decrypt, deriveKey } from '../lib/crypto.js';
import { closeMcpConnection } from '../lib/mcp-pool.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { isChromeBridgeConnected } from '../services/chromeBridge.js';

const router = Router();
router.use(requireAuth);

const VALID_TYPES = ['github', 'mcp', 'google', 'chrome'] as const;
const VALID_PURPOSES = ['github', 'mcp', 'tool', 'google', 'chrome'] as const;

const PURPOSE_ALLOWED_TYPES: Record<string, string[]> = {
  github: ['github'],
  mcp: ['mcp'],
  chrome: ['chrome'],
};

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare('SELECT id, name, type, purpose, service, url, notes, created_at, last_used_at FROM connections WHERE user_id = ? ORDER BY created_at')
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
  input: { name?: string; type?: string; purpose?: string; config?: unknown; service?: string; url?: string; notes?: string; managedToolPackage?: boolean },
): { id: string; type: string; purpose: string } {
  const { name, type, purpose, config, service, url, notes, managedToolPackage } = input;
  if (!name || !type) throw new ConnectionValidationError('name and type required');
  if (name.startsWith('tool:') && !managedToolPackage) {
    throw new ConnectionValidationError('Generated tool connections are managed by tool packages. Use request_tool_install or /tool-packages/:id/install.');
  }
  if (!config) throw new ConnectionValidationError('config required');
  if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
    throw new ConnectionValidationError(`type must be one of ${VALID_TYPES.join(', ')}`);
  }
  const connectionPurpose = purpose ?? 'tool';
  if (!VALID_PURPOSES.includes(connectionPurpose as (typeof VALID_PURPOSES)[number])) {
    throw new ConnectionValidationError(`purpose must be one of ${VALID_PURPOSES.join(', ')}`);
  }
  const allowedTypes = PURPOSE_ALLOWED_TYPES[connectionPurpose];
  if (allowedTypes && !allowedTypes.includes(type)) {
    throw new ConnectionValidationError(`Purpose '${connectionPurpose}' does not support type '${type}'. Allowed: ${allowedTypes.join(', ')}`);
  }
  const id = newId();
  const encrypted = encrypt(JSON.stringify(config ?? {}), deriveKey());
  try {
    getDb()
      .prepare('INSERT INTO connections (id, user_id, name, type, purpose, service, url, notes, encrypted_config) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, userId, name, type, connectionPurpose, service ?? null, url ?? null, notes ?? null, encrypted);
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
    if (err instanceof ConnectionValidationError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

router.get('/:id/test', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const row = getDb()
    .prepare('SELECT type, encrypted_config FROM connections WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { type: string; encrypted_config: string } | undefined;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }

  const start = Date.now();
  try {
    const config = JSON.parse(decrypt(row.encrypted_config, deriveKey())) as Record<string, string>;
    if (row.type === 'github') {
      const r = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${config.apiKey}`, 'User-Agent': 'unnamed-app' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } else if (row.type === 'google') {
      const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
      oauth2Client.setCredentials({ access_token: config.access_token, refresh_token: config.refresh_token });
      const info = google.oauth2({ version: 'v2', auth: oauth2Client });
      await info.userinfo.get();
    } else {
      res.json({ ok: null }); // MCP — not testable via HTTP
      return;
    }
    res.json({ ok: true, latencyMs: Date.now() - start });
  } catch (err) {
    res.json({ ok: false, error: (err as Error).message, latencyMs: Date.now() - start });
  }
});

router.get('/chrome/status', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const enabled = !!getDb()
    .prepare("SELECT id FROM connections WHERE user_id = ? AND type = 'chrome' LIMIT 1")
    .get(userId);

  res.json({ enabled, extensionConnected: isChromeBridgeConnected(userId) });
});


router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const row = getDb()
    .prepare('SELECT name FROM connections WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { name: string } | undefined;
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  if (row.name.startsWith('tool:')) {
    res.status(409).json({ error: 'Generated tool connections must be disabled from Tool Packages.' });
    return;
  }
  closeMcpConnection(req.params.id);
  const result = getDb()
    .prepare('DELETE FROM connections WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);
  if (result.changes === 0) { res.status(404).json({ error: 'Not found' }); return; }
  res.status(204).send();
});

export function touchConnection(connectionId: string): void {
  getDb().prepare('UPDATE connections SET last_used_at = unixepoch() WHERE id = ?').run(connectionId);
}

export function getDecryptedConfig(connectionId: string, userId: string): Record<string, string> {
  const row = getDb()
    .prepare('SELECT encrypted_config FROM connections WHERE id = ? AND user_id = ?')
    .get(connectionId, userId) as { encrypted_config: string } | undefined;
  if (!row) throw new Error(`Connection ${connectionId} not found`);
  return JSON.parse(decrypt(row.encrypted_config, deriveKey()));
}

export default router;
