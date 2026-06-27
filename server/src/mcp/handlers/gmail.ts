import { google } from 'googleapis';
import { getDb } from '../../db/index.js';
import { encrypt, decrypt, deriveKey } from '../../lib/crypto.js';
import { registerTool } from '../registry.js';

interface GmailConfig {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  email: string;
}

function getGmailClient(userId: string) {
  const row = getDb()
    .prepare("SELECT id, encrypted_config FROM connections WHERE user_id = ? AND type = 'google' AND name = 'gmail'")
    .get(userId) as { id: string; encrypted_config: string } | undefined;
  if (!row) throw new Error('Gmail not connected. Ask the user to connect Gmail in Settings.');

  const cfg = JSON.parse(decrypt(row.encrypted_config, deriveKey())) as GmailConfig;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set');

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({
    access_token: cfg.access_token,
    refresh_token: cfg.refresh_token,
    expiry_date: cfg.expiry_date,
  });

  // Persist refreshed tokens
  oauth2.on('tokens', (tokens) => {
    const updated = { ...cfg, ...tokens };
    getDb()
      .prepare("UPDATE connections SET encrypted_config = ? WHERE user_id = ? AND type = 'google' AND name = 'gmail'")
      .run(encrypt(JSON.stringify(updated), deriveKey()), userId);
  });

  return google.gmail({ version: 'v1', auth: oauth2 });
}

function decodeBody(payload: { mimeType?: string | null; body?: { data?: string | null } | null; parts?: unknown[] | null } | null | undefined): string {
  if (!payload) return '';
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  }
  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const text = decodeBody(part as typeof payload);
      if (text) return text;
    }
  }
  return '';
}

function headerVal(headers: { name?: string | null; value?: string | null }[], name: string): string {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export function registerGmailHandlers(): void {
  registerTool({
    name: 'gmail_list',
    description: 'List Gmail messages. Returns id, subject, from, date, and snippet for each. Use gmail_read to get the full body.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query, e.g. "is:unread", "from:boss@co.com", "subject:invoice". Defaults to inbox.' },
        max: { type: 'number', description: 'Max messages to return (default 20, max 50)' },
      },
    },
    handler: async (_args, userId) => {
      const args = _args as { query?: string; max?: number };
      const gmail = getGmailClient(userId);
      const q = args.query ?? 'in:inbox';
      const maxResults = Math.min(args.max ?? 20, 50);
      const list = await gmail.users.messages.list({ userId: 'me', q, maxResults });
      const messages = list.data.messages ?? [];
      if (messages.length === 0) return JSON.stringify([]);

      const results = await Promise.all(
        messages.map(async (m) => {
          const msg = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
          const headers = msg.data.payload?.headers ?? [];
          return {
            id: m.id,
            subject: headerVal(headers, 'Subject'),
            from: headerVal(headers, 'From'),
            date: headerVal(headers, 'Date'),
            snippet: msg.data.snippet ?? '',
          };
        }),
      );
      return JSON.stringify(results);
    },
  });

  registerTool({
    name: 'gmail_read',
    description: 'Read the full content of a Gmail message by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Message id from gmail_list' } },
      required: ['id'],
    },
    handler: async (_args, userId) => {
      const args = _args as { id: string };
      const gmail = getGmailClient(userId);
      const msg = await gmail.users.messages.get({ userId: 'me', id: args.id, format: 'full' });
      const headers = msg.data.payload?.headers ?? [];
      return JSON.stringify({
        id: args.id,
        threadId: msg.data.threadId,
        subject: headerVal(headers, 'Subject'),
        from: headerVal(headers, 'From'),
        to: headerVal(headers, 'To'),
        date: headerVal(headers, 'Date'),
        body: decodeBody(msg.data.payload),
      });
    },
  });

  registerTool({
    name: 'gmail_send',
    description: 'Send an email from the connected Gmail account.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain text body' },
        cc: { type: 'string', description: 'CC address (optional)' },
      },
      required: ['to', 'subject', 'body'],
    },
    handler: async (_args, userId) => {
      const args = _args as { to: string; subject: string; body: string; cc?: string };
      const gmail = getGmailClient(userId);
      const row = getDb()
        .prepare("SELECT encrypted_config FROM connections WHERE user_id = ? AND type = 'google' AND name = 'gmail'")
        .get(userId) as { encrypted_config: string };
      const cfg = JSON.parse(decrypt(row.encrypted_config, deriveKey())) as GmailConfig;

      const lines = [
        `From: ${cfg.email}`,
        `To: ${args.to}`,
        ...(args.cc ? [`Cc: ${args.cc}`] : []),
        `Subject: ${args.subject}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        args.body,
      ];
      const raw = Buffer.from(lines.join('\r\n')).toString('base64url');
      const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return JSON.stringify({ id: sent.data.id, threadId: sent.data.threadId });
    },
  });

  registerTool({
    name: 'gmail_reply',
    description: 'Reply to an existing Gmail thread.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'The message id to reply to (from gmail_list or gmail_read)' },
        body: { type: 'string', description: 'Plain text reply body' },
      },
      required: ['message_id', 'body'],
    },
    handler: async (_args, userId) => {
      const args = _args as { message_id: string; body: string };
      const gmail = getGmailClient(userId);
      const row = getDb()
        .prepare("SELECT encrypted_config FROM connections WHERE user_id = ? AND type = 'google' AND name = 'gmail'")
        .get(userId) as { encrypted_config: string };
      const cfg = JSON.parse(decrypt(row.encrypted_config, deriveKey())) as GmailConfig;

      const orig = await gmail.users.messages.get({ userId: 'me', id: args.message_id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Message-ID'] });
      const headers = orig.data.payload?.headers ?? [];
      const subject = headerVal(headers, 'Subject');
      const from = headerVal(headers, 'From');
      const messageId = headerVal(headers, 'Message-ID');

      const lines = [
        `From: ${cfg.email}`,
        `To: ${from}`,
        `Subject: ${subject.startsWith('Re:') ? subject : `Re: ${subject}`}`,
        ...(messageId ? [`In-Reply-To: ${messageId}`, `References: ${messageId}`] : []),
        'Content-Type: text/plain; charset=utf-8',
        '',
        args.body,
      ];
      const raw = Buffer.from(lines.join('\r\n')).toString('base64url');
      const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId: orig.data.threadId ?? undefined } });
      return JSON.stringify({ id: sent.data.id, threadId: sent.data.threadId });
    },
  });

  registerTool({
    name: 'gmail_search',
    description: 'Search Gmail with a query and return matching messages with full snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query, e.g. "from:alice@example.com subject:invoice after:2024/01/01"' },
        max: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
    handler: async (_args, userId) => {
      const args = _args as { query: string; max?: number };
      const gmail = getGmailClient(userId);
      const maxResults = Math.min(args.max ?? 10, 30);
      const list = await gmail.users.messages.list({ userId: 'me', q: args.query, maxResults });
      const messages = list.data.messages ?? [];
      if (messages.length === 0) return JSON.stringify([]);

      const results = await Promise.all(
        messages.map(async (m) => {
          const msg = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
          const headers = msg.data.payload?.headers ?? [];
          return {
            id: m.id,
            subject: headerVal(headers, 'Subject'),
            from: headerVal(headers, 'From'),
            date: headerVal(headers, 'Date'),
            snippet: msg.data.snippet ?? '',
          };
        }),
      );
      return JSON.stringify(results);
    },
  });
}
