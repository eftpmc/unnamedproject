import { google, drive_v3 } from 'googleapis';
import { getDb } from '../db/index.js';
import { encrypt, decrypt, deriveKey } from '../lib/crypto.js';

interface DriveConfig {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  email: string;
}

export async function getDriveClient(userId: string, account?: string): Promise<{ drive: drive_v3.Drive; email: string }> {
  const row = account
    ? (getDb()
        .prepare("SELECT id, encrypted_config FROM connections WHERE user_id = ? AND type = 'google' AND service = 'drive' AND name = ?")
        .get(userId, account) as { id: string; encrypted_config: string } | undefined)
    : (getDb()
        .prepare("SELECT id, encrypted_config FROM connections WHERE user_id = ? AND type = 'google' AND service = 'drive' ORDER BY created_at LIMIT 1")
        .get(userId) as { id: string; encrypted_config: string } | undefined);

  if (!row) throw new Error(account ? `Drive account '${account}' not found.` : 'Google Drive not connected — connect it in Settings.');

  const cfg = JSON.parse(decrypt(row.encrypted_config, deriveKey())) as DriveConfig;

  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ access_token: cfg.access_token, refresh_token: cfg.refresh_token, expiry_date: cfg.expiry_date });

  if (!cfg.expiry_date || cfg.expiry_date - Date.now() < 5 * 60 * 1000) {
    const { credentials } = await oauth2.refreshAccessToken();
    const updated: DriveConfig = {
      ...cfg,
      access_token: credentials.access_token ?? cfg.access_token,
      refresh_token: credentials.refresh_token ?? cfg.refresh_token,
      expiry_date: credentials.expiry_date ?? cfg.expiry_date,
    };
    getDb()
      .prepare('UPDATE connections SET encrypted_config = ? WHERE id = ?')
      .run(encrypt(JSON.stringify(updated), deriveKey()), row.id);
    oauth2.setCredentials(updated);
  }

  return { drive: google.drive({ version: 'v3', auth: oauth2 }), email: cfg.email };
}

export async function listFiles(userId: string, query: string | undefined, maxResults: number, account?: string): Promise<string> {
  const { drive } = await getDriveClient(userId, account);
  const { data } = await drive.files.list({
    q: query,
    pageSize: Math.min(maxResults, 50),
    fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
    orderBy: 'modifiedTime desc',
  });
  const files = data.files ?? [];
  if (files.length === 0) return 'No files found.';
  return files.map(f =>
    `[${f.id}] ${f.name}\nType: ${f.mimeType} | Modified: ${f.modifiedTime}\nLink: ${f.webViewLink ?? 'n/a'}`
  ).join('\n\n');
}

export async function getFileContent(userId: string, fileId: string, account?: string): Promise<string> {
  const { drive } = await getDriveClient(userId, account);

  const { data: meta } = await drive.files.get({ fileId, fields: 'name,mimeType' });
  const mimeType = meta.mimeType ?? '';

  const EXPORT_MIME: Record<string, string> = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
  };

  if (EXPORT_MIME[mimeType]) {
    const { data } = await drive.files.export({ fileId, mimeType: EXPORT_MIME[mimeType] }, { responseType: 'text' });
    return String(data);
  }

  if (mimeType.startsWith('text/') || mimeType === 'application/json') {
    const { data } = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
    return String(data);
  }

  return `File "${meta.name}" (${mimeType}) is a binary file and cannot be read as text.`;
}

export async function createFile(userId: string, name: string, content: string, folderId?: string, account?: string): Promise<string> {
  const { drive } = await getDriveClient(userId, account);
  const { data } = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'text/plain',
      ...(folderId ? { parents: [folderId] } : {}),
    },
    media: { mimeType: 'text/plain', body: content },
    fields: 'id,name,webViewLink',
  });
  return `File created: "${data.name}" (ID: ${data.id})\nLink: ${data.webViewLink ?? 'n/a'}`;
}
