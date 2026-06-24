import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { getDataDir, getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { runAgentTurn } from '../services/agent.js';
import { broadcast } from '../services/socket.js';

const router = Router();
router.use(requireAuth);

const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/json',
  'application/pdf',
  'application/sql',
  'application/xml',
  'application/x-sh',
  'application/x-yaml',
  'text/csv',
  'text/html',
  'text/markdown',
  'text/plain',
  'text/xml',
]);
const ALLOWED_MIME_PREFIXES = ['image/'];
const ALLOWED_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.css', '.csv', '.env', '.gif', '.go', '.h', '.hpp',
  '.html', '.java', '.jpeg', '.jpg', '.js', '.json', '.jsx', '.kt', '.md',
  '.pdf', '.png', '.py', '.rb', '.rs', '.sh', '.sql', '.swift', '.toml',
  '.ts', '.tsx', '.txt', '.webp', '.xml', '.yaml', '.yml', '.zsh',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_ATTACHMENTS, fileSize: MAX_ATTACHMENT_BYTES },
});

interface DbAttachment {
  id: string;
  messageId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: number;
}

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename).replace(/[^\w.\- ()[\]]+/g, '_').trim();
  return base || 'attachment';
}

function isAllowedAttachment(file: Express.Multer.File): boolean {
  const mimeType = file.mimetype || 'application/octet-stream';
  if (ALLOWED_MIME_TYPES.has(mimeType)) return true;
  if (ALLOWED_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix))) return true;
  return ALLOWED_EXTENSIONS.has(path.extname(file.originalname).toLowerCase());
}

function removeAttachmentFilesForMessages(messageIds: string[]): void {
  if (messageIds.length === 0) return;
  const attachmentsRoot = path.resolve(getDataDir(), 'attachments');
  const rows = getDb()
    .prepare(`SELECT storage_path as storagePath FROM message_attachments WHERE message_id IN (${messageIds.map(() => '?').join(',')})`)
    .all(...messageIds) as { storagePath: string }[];
  const dirs = new Set<string>();
  for (const row of rows) {
    const storagePath = path.resolve(row.storagePath);
    if (!storagePath.startsWith(`${attachmentsRoot}${path.sep}`)) continue;
    try {
      fs.rmSync(storagePath, { force: true });
      dirs.add(path.dirname(storagePath));
    } catch (err) {
      console.warn('[attachment cleanup]', err);
    }
  }
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn('[attachment cleanup]', err);
    }
  }
}

function getAttachmentsForMessages(messageIds: string[]): Map<string, DbAttachment[]> {
  if (messageIds.length === 0) return new Map();
  const attachments = getDb()
    .prepare(`
      SELECT id, message_id as messageId, filename, mime_type as mimeType,
             size_bytes as sizeBytes, storage_path as storagePath, created_at as createdAt
      FROM message_attachments
      WHERE message_id IN (${messageIds.map(() => '?').join(',')})
      ORDER BY created_at, filename
    `)
    .all(...messageIds) as DbAttachment[];

  const byMessage = new Map<string, DbAttachment[]>();
  for (const attachment of attachments) {
    const list = byMessage.get(attachment.messageId) ?? [];
    list.push(attachment);
    byMessage.set(attachment.messageId, list);
  }
  return byMessage;
}

function serializeAttachment(sessionId: string, attachment: DbAttachment) {
  return {
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    url: `/sessions/${sessionId}/messages/${attachment.messageId}/attachments/${attachment.id}`,
    createdAt: attachment.createdAt,
  };
}

router.get('/:sessionId/messages', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const session = getDb()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.sessionId, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  const messages = getDb()
    .prepare('SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at')
    .all(req.params.sessionId) as { id: string; role: string; content: string; created_at: number }[];
  const attachmentsByMessage = getAttachmentsForMessages(messages.map(m => m.id));

  const executions = getDb()
    .prepare(`
      SELECT e.id as executionId, e.message_id as messageId, e.tool, e.status, e.output_log as outputLog,
             e.result, e.created_at as createdAt, p.name as projectName, a.id as approvalId, a.action
      FROM executions e
      LEFT JOIN spaces p ON p.id = e.space_id
      LEFT JOIN approvals a ON a.execution_id = e.id AND a.status = 'pending'
      WHERE e.message_id IN (${messages.map(() => '?').join(',') || "''"})
      ORDER BY e.created_at
    `)
    .all(...messages.map(m => m.id)) as Array<{
      executionId: string; messageId: string; tool: string; status: string; outputLog: string;
      result: string | null; createdAt: number; projectName: string | null; approvalId: string | null; action: string | null;
    }>;

  const executionsByMessage = new Map<string, typeof executions>();
  for (const e of executions) {
    const list = executionsByMessage.get(e.messageId) ?? [];
    list.push(e);
    executionsByMessage.set(e.messageId, list);
  }

  res.json(messages.map(m => ({
    ...m,
    attachments: (attachmentsByMessage.get(m.id) ?? []).map(a => serializeAttachment(req.params.sessionId, a)),
    executions: (executionsByMessage.get(m.id) ?? []).map(e => ({
      executionId: e.executionId,
      tool: e.tool,
      projectName: e.projectName ?? undefined,
      status: e.status,
      outputLog: e.outputLog,
      result: e.result,
      createdAt: e.createdAt,
      needsApproval: e.status === 'awaiting_approval' && !!e.approvalId,
      approvalId: e.approvalId,
      action: e.action,
    })),
  })));
});

router.get('/:sessionId/messages/:messageId/attachments/:attachmentId', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const session = getDb()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.sessionId, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  const attachment = getDb()
    .prepare(`
      SELECT a.filename, a.mime_type as mimeType, a.storage_path as storagePath
      FROM message_attachments a
      JOIN messages m ON m.id = a.message_id
      WHERE a.id = ? AND a.message_id = ? AND m.session_id = ?
    `)
    .get(req.params.attachmentId, req.params.messageId, req.params.sessionId) as { filename: string; mimeType: string; storagePath: string } | undefined;
  if (!attachment || !fs.existsSync(attachment.storagePath)) { res.status(404).json({ error: 'Attachment not found' }); return; }

  res.type(attachment.mimeType);
  res.download(attachment.storagePath, attachment.filename);
});

router.post('/:sessionId/messages', upload.array('attachments', MAX_ATTACHMENTS), async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { content } = req.body as { content?: string };
  const files = (req.files ?? []) as Express.Multer.File[];
  if (!content?.trim() && files.length === 0) { res.status(400).json({ error: 'content or attachment required' }); return; }
  const unsupported = files.find(file => !isAllowedAttachment(file));
  if (unsupported) {
    res.status(415).json({ error: `Unsupported attachment type for ${sanitizeFilename(unsupported.originalname)}` });
    return;
  }

  const session = getDb()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.sessionId, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  const messageId = newId();
  getDb()
    .prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
    .run(messageId, req.params.sessionId, 'user', content?.trim() ?? '');

  const uploadDir = path.join(getDataDir(), 'attachments', userId, req.params.sessionId, messageId);
  const savedAttachments: DbAttachment[] = [];
  if (files.length) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  for (const file of files) {
    const attachmentId = newId();
    const filename = sanitizeFilename(file.originalname);
    const storagePath = path.join(uploadDir, `${attachmentId}-${filename}`);
    fs.writeFileSync(storagePath, file.buffer);
    getDb()
      .prepare('INSERT INTO message_attachments (id, message_id, filename, mime_type, size_bytes, storage_path) VALUES (?,?,?,?,?,?)')
      .run(attachmentId, messageId, filename, file.mimetype || 'application/octet-stream', file.size, storagePath);
    savedAttachments.push({
      id: attachmentId,
      messageId,
      filename,
      mimeType: file.mimetype || 'application/octet-stream',
      sizeBytes: file.size,
      storagePath,
      createdAt: Math.floor(Date.now() / 1000),
    });
  }

  getDb()
    .prepare('UPDATE sessions SET updated_at = unixepoch() WHERE id = ?')
    .run(req.params.sessionId);
  const turnId = newId();
  getDb()
    .prepare('INSERT INTO session_turns (id, session_id, user_message_id, status) VALUES (?,?,?,?)')
    .run(turnId, req.params.sessionId, messageId, 'running');

  const userMessage = {
    id: messageId,
    role: 'user',
    content: content?.trim() ?? '',
    created_at: Math.floor(Date.now() / 1000),
    attachments: savedAttachments.map(a => serializeAttachment(req.params.sessionId, a)),
  };
  res.status(201).json(userMessage);

  // Trigger agent turn async — client gets reply via WebSocket
  setImmediate(async () => {
    try {
      await runAgentTurn(userId, req.params.sessionId, messageId);
    } catch (err) {
      console.error('[agent turn error]', err);
      const error = err instanceof Error ? err.message : String(err);
      getDb()
        .prepare("UPDATE session_turns SET status = 'error', error = ?, completed_at = unixepoch() WHERE session_id = ? AND user_message_id = ? AND status = 'running'")
        .run(error, req.params.sessionId, messageId);
      broadcast(userId, { type: 'agent_error', sessionId: req.params.sessionId, error });
      broadcast(userId, { type: 'turn_complete', sessionId: req.params.sessionId, status: 'error' });
    }
  });
});

router.delete('/:sessionId/messages/from/:messageId', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { sessionId, messageId } = req.params;

  const session = getDb()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  const message = getDb()
    .prepare('SELECT rowid FROM messages WHERE id = ? AND session_id = ?')
    .get(messageId, sessionId) as { rowid: number } | undefined;
  if (!message) { res.status(404).json({ error: 'Message not found' }); return; }

  const deletedMessages = getDb()
    .prepare('SELECT id FROM messages WHERE session_id = ? AND rowid >= ?')
    .all(sessionId, message.rowid) as { id: string }[];
  removeAttachmentFilesForMessages(deletedMessages.map(m => m.id));

  const result = getDb()
    .prepare('DELETE FROM messages WHERE session_id = ? AND rowid >= ?')
    .run(sessionId, message.rowid);

  res.json({ deleted: result.changes });
});

export default router;
