import { Router } from 'express';
import { google } from 'googleapis';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { encrypt, decrypt, deriveKey } from '../lib/crypto.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
  const redirectUri = `${process.env.APP_URL ?? 'http://localhost:3000'}/auth/google/callback`;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

const SERVICE_SCOPES: Record<string, string[]> = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  drive: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
};

// GET /auth/google/url?service=gmail[&label=work] — return OAuth URL as JSON
router.get('/url', requireAuth, (req, res) => {
  const { userId } = req as AuthedRequest;
  const service = (req.query.service as string) ?? 'gmail';
  const label = (req.query.label as string | undefined) ?? service;
  const scopes = SERVICE_SCOPES[service];
  if (!scopes) { res.status(400).json({ error: `Unknown service: ${service}` }); return; }
  try {
    const oauth2 = getOAuthClient();
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes,
      state: `${userId}:${service}:${label}`,
    });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /auth/google/callback — Google redirects here after consent
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

  if (error) { res.redirect(`${frontendUrl}/settings?google_error=${encodeURIComponent(error)}`); return; }
  if (!code || !state) { res.status(400).json({ error: 'Missing code or state' }); return; }

  // State format: userId:service:label  (legacy: userId:service)
  const parts = state.split(':');
  const userId = parts[0];
  const service = parts[1] ?? 'gmail';
  const label = parts.slice(2).join(':') || service;

  if (!userId) { res.status(400).json({ error: 'Invalid state' }); return; }

  try {
    const oauth2 = getOAuthClient();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    const oauth2Info = google.oauth2({ version: 'v2', auth: oauth2 });
    const { data: userInfo } = await oauth2Info.userinfo.get();
    const email = userInfo.email ?? '';

    const config = JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      email,
    });
    const encrypted = encrypt(config, deriveKey());

    const db = getDb();
    // Check for existing connection with same label for this user
    const existing = db
      .prepare("SELECT id FROM connections WHERE user_id = ? AND type = 'google' AND name = ?")
      .get(userId, label) as { id: string } | undefined;

    if (existing) {
      db.prepare('UPDATE connections SET encrypted_config = ?, service = ? WHERE id = ?').run(encrypted, service, existing.id);
    } else {
      db.prepare(
        'INSERT INTO connections (id, user_id, name, type, purpose, service, encrypted_config) VALUES (?,?,?,?,?,?,?)',
      ).run(newId(), userId, label, 'google', 'google', service, encrypted);
    }

    res.redirect(`${frontendUrl}/settings?google_connected=${encodeURIComponent(service)}`);
  } catch (err) {
    res.redirect(`${frontendUrl}/settings?google_error=${encodeURIComponent((err as Error).message)}`);
  }
});

// GET /auth/google/status — connected Google accounts grouped by service
router.get('/status', requireAuth, (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare("SELECT id, name, service, encrypted_config FROM connections WHERE user_id = ? AND type = 'google'")
    .all(userId) as { id: string; name: string; service: string; encrypted_config: string }[];

  const result: Record<string, { id: string; name: string; email: string }[]> = {};
  for (const row of rows) {
    try {
      const cfg = JSON.parse(decrypt(row.encrypted_config, deriveKey())) as { email: string };
      const svc = row.service ?? row.name; // fallback for pre-migration rows
      if (!result[svc]) result[svc] = [];
      result[svc].push({ id: row.id, name: row.name, email: cfg.email });
    } catch { /* skip malformed rows */ }
  }
  res.json(result);
});

// DELETE /auth/google/:id — disconnect a Google account by connection ID
router.delete('/:id', requireAuth, (req, res) => {
  const { userId } = req as AuthedRequest;
  const result = getDb()
    .prepare("DELETE FROM connections WHERE id = ? AND user_id = ? AND type = 'google'")
    .run(req.params.id, userId);
  if (result.changes === 0) { res.status(404).json({ error: 'Not found' }); return; }
  res.status(204).send();
});

export default router;
