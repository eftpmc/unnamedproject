import { google, gmail_v1 } from 'googleapis';
import { getDb } from '../db/index.js';
import { encrypt, decrypt, deriveKey } from '../lib/crypto.js';

interface GmailConfig {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  email: string;
}

export async function getGmailClient(userId: string, account?: string): Promise<{ gmail: gmail_v1.Gmail; email: string }> {
  const row = account
    ? (getDb()
        .prepare("SELECT id, encrypted_config FROM connections WHERE user_id = ? AND type = 'google' AND service = 'gmail' AND name = ?")
        .get(userId, account) as { id: string; encrypted_config: string } | undefined)
    : (getDb()
        .prepare("SELECT id, encrypted_config FROM connections WHERE user_id = ? AND type = 'google' AND service = 'gmail' ORDER BY created_at LIMIT 1")
        .get(userId) as { id: string; encrypted_config: string } | undefined);

  if (!row) throw new Error(account ? `Gmail account '${account}' not found.` : 'Gmail not connected — connect it in Settings.');

  const cfg = JSON.parse(decrypt(row.encrypted_config, deriveKey())) as GmailConfig;

  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ access_token: cfg.access_token, refresh_token: cfg.refresh_token, expiry_date: cfg.expiry_date });

  if (!cfg.expiry_date || cfg.expiry_date - Date.now() < 5 * 60 * 1000) {
    const { credentials } = await oauth2.refreshAccessToken();
    const updated: GmailConfig = {
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

  return { gmail: google.gmail({ version: 'v1', auth: oauth2 }), email: cfg.email };
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';
  if (payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  for (const part of payload.parts ?? []) {
    if ((part.mimeType === 'text/plain' || part.mimeType === 'text/html') && part.body?.data) {
      return Buffer.from(part.body.data, 'base64url').toString('utf-8');
    }
    const nested = extractBody(part);
    if (nested) return nested;
  }
  return '';
}

function buildRaw(from: string, to: string, subject: string, body: string, inReplyTo?: string): string {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  lines.push('', body);
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

export async function searchThreads(userId: string, query: string, maxResults: number, account?: string): Promise<string> {
  const { gmail } = await getGmailClient(userId, account);
  const { data } = await gmail.users.threads.list({ userId: 'me', q: query, maxResults: Math.min(maxResults, 25) });
  const threads = data.threads ?? [];
  if (threads.length === 0) return 'No threads found.';

  const details = await Promise.all(
    threads.map(t => gmail.users.threads.get({ userId: 'me', id: t.id!, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] }))
  );

  return details.map(({ data: t }) => {
    const h = t.messages?.[0]?.payload?.headers ?? [];
    const g = (n: string) => h.find(x => x.name === n)?.value ?? '';
    return `[${t.id}] ${g('Subject')}\nFrom: ${g('From')} | ${g('Date')}\n${t.snippet ?? ''}`;
  }).join('\n\n');
}

export async function getThread(userId: string, threadId: string, account?: string): Promise<string> {
  const { gmail } = await getGmailClient(userId, account);
  const { data: t } = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  return (t.messages ?? []).map(msg => {
    const h = msg.payload?.headers ?? [];
    const g = (n: string) => h.find(x => x.name === n)?.value ?? '';
    return `From: ${g('From')}\nTo: ${g('To')}\nDate: ${g('Date')}\nSubject: ${g('Subject')}\n\n${extractBody(msg.payload)}`;
  }).join('\n\n---\n\n');
}

export async function listLabels(userId: string, account?: string): Promise<string> {
  const { gmail } = await getGmailClient(userId, account);
  const { data } = await gmail.users.labels.list({ userId: 'me' });
  return (data.labels ?? []).map(l => `${l.id}: ${l.name}`).join('\n');
}

export async function createDraft(userId: string, to: string, subject: string, body: string, inReplyTo?: string, account?: string): Promise<string> {
  const { gmail, email } = await getGmailClient(userId, account);
  const { data } = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw: buildRaw(email, to, subject, body, inReplyTo) } } });
  return `Draft created (ID: ${data.id}).`;
}

export async function sendMessage(userId: string, to: string, subject: string, body: string, inReplyTo?: string, account?: string): Promise<string> {
  const { gmail, email } = await getGmailClient(userId, account);
  const { data } = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: buildRaw(email, to, subject, body, inReplyTo) } });
  return `Message sent (ID: ${data.id}).`;
}

export async function sendDraft(userId: string, draftId: string, account?: string): Promise<string> {
  const { gmail } = await getGmailClient(userId, account);
  const { data } = await gmail.users.drafts.send({ userId: 'me', requestBody: { id: draftId } });
  return `Draft sent (message ID: ${data.id}).`;
}

export async function trashThreads(userId: string, threadIds: string[], account?: string): Promise<string> {
  const { gmail } = await getGmailClient(userId, account);
  await Promise.all(threadIds.map(id => gmail.users.threads.trash({ userId: 'me', id })));
  return `Trashed ${threadIds.length} thread(s).`;
}

export async function archiveThreads(userId: string, threadIds: string[], account?: string): Promise<string> {
  const { gmail } = await getGmailClient(userId, account);
  await Promise.all(threadIds.map(id => gmail.users.threads.modify({ userId: 'me', id, requestBody: { removeLabelIds: ['INBOX'] } })));
  return `Archived ${threadIds.length} thread(s).`;
}

export async function modifyLabels(userId: string, threadIds: string[], addLabelIds: string[], removeLabelIds: string[], account?: string): Promise<string> {
  const { gmail } = await getGmailClient(userId, account);
  await Promise.all(threadIds.map(id => gmail.users.threads.modify({ userId: 'me', id, requestBody: { addLabelIds, removeLabelIds } })));
  return `Modified labels on ${threadIds.length} thread(s).`;
}
