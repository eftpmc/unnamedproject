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

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
];

// GET /auth/google/url?service=gmail — return OAuth URL as JSON (called by frontend with auth header)
router.get('/url', requireAuth, (req, res) => {
  const { userId } = req as AuthedRequest;
  const service = (req.query.service as string) ?? 'gmail';
  try {
    const oauth2 = getOAuthClient();
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GMAIL_SCOPES,
      state: `${userId}:${service}`,
    });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /auth/google/callback — Google redirects here after consent
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  if (error) {
    res.redirect(`/settings?google_error=${encodeURIComponent(error)}`);
    return;
  }
  if (!code || !state) {
    res.status(400).json({ error: 'Missing code or state' });
    return;
  }

  const [userId, service] = state.split(':');
  if (!userId) { res.status(400).json({ error: 'Invalid state' }); return; }

  try {
    const oauth2 = getOAuthClient();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    // Get user email
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
    const existing = db
      .prepare("SELECT id FROM connections WHERE user_id = ? AND type = 'google' AND name = ?")
      .get(userId, service) as { id: string } | undefined;

    if (existing) {
      db.prepare('UPDATE connections SET encrypted_config = ? WHERE id = ?').run(encrypted, existing.id);
    } else {
      db.prepare(
        'INSERT INTO connections (id, user_id, name, type, purpose, encrypted_config) VALUES (?,?,?,?,?,?)',
      ).run(newId(), userId, service, 'google', service, encrypted);
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    res.redirect(`${frontendUrl}/settings?google_connected=${encodeURIComponent(service)}`);
  } catch (err) {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    res.redirect(`${frontendUrl}/settings?google_error=${encodeURIComponent((err as Error).message)}`);
  }
});

// GET /auth/google/status — which Google services are connected for the current user
router.get('/status', requireAuth, (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare("SELECT name, encrypted_config FROM connections WHERE user_id = ? AND type = 'google'")
    .all(userId) as { name: string; encrypted_config: string }[];

  const result: Record<string, { email: string }> = {};
  for (const row of rows) {
    try {
      const cfg = JSON.parse(decrypt(row.encrypted_config, deriveKey())) as { email: string };
      result[row.name] = { email: cfg.email };
    } catch { /* skip */ }
  }
  res.json(result);
});

// DELETE /auth/google/:service — disconnect a Google service
router.delete('/:service', requireAuth, (req, res) => {
  const { userId } = req as AuthedRequest;
  getDb()
    .prepare("DELETE FROM connections WHERE user_id = ? AND type = 'google' AND name = ?")
    .run(userId, req.params.service);
  res.status(204).send();
});

export default router;
