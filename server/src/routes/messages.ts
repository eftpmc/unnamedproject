import { Router } from 'express';
import path from 'path';
import multer from 'multer';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { runAgentTurn } from '../services/agent.js';
import { broadcast } from '../services/socket.js';
import { writeBinaryFile, writeFile } from '../services/files.js';
import { logger } from '../lib/logger.js';

const router = Router();
router.use(requireAuth);

const MAX_UPLOADS = 8;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
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
const TEXT_MIME_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/html', 'text/css', 'text/javascript',
  'text/typescript', 'application/json', 'application/xml', 'application/yaml',
  'application/x-yaml', 'text/csv', 'text/xml', 'application/sql', 'application/x-sh',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_UPLOADS, fileSize: MAX_UPLOAD_BYTES },
});

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename).replace(/[^\w.\- ()[\]]+/g, '_').trim();
  return base || 'upload';
}

function isAllowed(file: Express.Multer.File): boolean {
  const mimeType = file.mimetype || 'application/octet-stream';
  if (ALLOWED_MIME_TYPES.has(mimeType)) return true;
  if (ALLOWED_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix))) return true;
  return ALLOWED_EXTENSIONS.has(path.extname(file.originalname).toLowerCase());
}

function isText(mimeType: string): boolean {
  return TEXT_MIME_TYPES.has(mimeType) || mimeType.startsWith('text/');
}

interface UploadedDoc {
  id: string;
  title: string;
  mimeType: string;
}

function getUploadsForMessages(messageIds: string[]): Map<string, UploadedDoc[]> {
  if (messageIds.length === 0) return new Map();
  const rows = getDb()
    .prepare(`
      SELECT mf.message_id as messageId, d.id, d.title, d.mime_type as mimeType
      FROM message_files mf
      JOIN files d ON d.id = mf.document_id
      WHERE mf.message_id IN (${messageIds.map(() => '?').join(',')})
      ORDER BY d.created_at, d.title
    `)
    .all(...messageIds) as (UploadedDoc & { messageId: string })[];

  const byMessage = new Map<string, UploadedDoc[]>();
  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? [];
    list.push({ id: row.id, title: row.title, mimeType: row.mimeType });
    byMessage.set(row.messageId, list);
  }
  return byMessage;
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
  const uploadsByMessage = getUploadsForMessages(messages.map(m => m.id));

  const executions = getDb()
    .prepare(`
      SELECT e.id as executionId, e.message_id as messageId, e.tool, e.status, e.output_log as outputLog,
             e.result, e.created_at as createdAt, p.name as projectName, a.id as approvalId, a.action
      FROM executions e
      LEFT JOIN projects p ON p.id = e.project_id
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
    uploads: uploadsByMessage.get(m.id) ?? [],
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

router.post('/:sessionId/messages', upload.array('attachments', MAX_UPLOADS), async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { content } = req.body as { content?: string };
  const files = (req.files ?? []) as Express.Multer.File[];
  if (!content?.trim() && files.length === 0) { res.status(400).json({ error: 'content or file required' }); return; }

  const unsupported = files.find(file => !isAllowed(file));
  if (unsupported) {
    res.status(415).json({ error: `Unsupported file type: ${sanitizeFilename(unsupported.originalname)}` });
    return;
  }

  const session = getDb()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.sessionId, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  let projectId: string | null = null;
  if (files.length > 0) {
    const row = getDb()
      .prepare('SELECT p.id as project_id FROM sessions s JOIN projects p ON p.id = s.pinned_project_id WHERE s.id = ? AND s.user_id = ?')
      .get(req.params.sessionId, userId) as { project_id: string } | undefined;
    if (!row) {
      res.status(400).json({ error: 'Pin a project to this chat before uploading files.' });
      return;
    }
    projectId = row.project_id;
  }

  const messageId = newId();
  getDb()
    .prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
    .run(messageId, req.params.sessionId, 'user', content?.trim() ?? '');

  const savedUploads: UploadedDoc[] = [];
  if (files.length && projectId) {
    for (const file of files) {
      const filename = sanitizeFilename(file.originalname);
      const title = path.basename(filename, path.extname(filename));
      const mimeType = file.mimetype || 'application/octet-stream';
      const ext = path.extname(filename) || '';
      let docPath = filename;
      let counter = 2;
      const stem = filename.slice(0, filename.length - ext.length);
      while (getDb().prepare('SELECT id FROM files WHERE project_id = ? AND path = ?').get(projectId, docPath)) {
        docPath = `${stem}-${counter}${ext}`;
        counter++;
      }

      let doc;
      if (isText(mimeType)) {
        doc = await writeFile({
          project_id: projectId,
          path: docPath,
          title,
          body: file.buffer.toString('utf-8'),
          source_session_id: req.params.sessionId,
        });
      } else {
        doc = await writeBinaryFile({
          project_id: projectId,
          path: docPath,
          title,
          mime_type: mimeType,
          data: file.buffer,
          source_session_id: req.params.sessionId,
        });
      }

      getDb()
        .prepare('INSERT OR IGNORE INTO message_files (message_id, document_id) VALUES (?,?)')
        .run(messageId, doc.id);
      savedUploads.push({ id: doc.id, title: doc.title, mimeType: doc.mime_type });
    }
  }

  getDb()
    .prepare('UPDATE sessions SET updated_at = unixepoch() WHERE id = ?')
    .run(req.params.sessionId);
  const turnId = newId();
  getDb()
    .prepare('INSERT INTO session_turns (id, session_id, user_message_id, status) VALUES (?,?,?,?)')
    .run(turnId, req.params.sessionId, messageId, 'running');

  res.status(201).json({
    id: messageId,
    role: 'user',
    content: content?.trim() ?? '',
    created_at: Math.floor(Date.now() / 1000),
    uploads: savedUploads,
  });

  setImmediate(async () => {
    try {
      await runAgentTurn(userId, req.params.sessionId, messageId);
    } catch (err) {
      logger.error('[agent turn error]', { err: err instanceof Error ? err.message : String(err) });
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

  const result = getDb()
    .prepare('DELETE FROM messages WHERE session_id = ? AND rowid >= ?')
    .run(sessionId, message.rowid);

  res.json({ deleted: result.changes });
});

export default router;
