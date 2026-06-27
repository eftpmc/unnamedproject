import { getDb, recordAgentUsage, setSessionProviderInfo, type AgentUsageTool } from '../db/index.js';
import { broadcast } from './socket.js';
import { newId } from '../lib/ids.js';
import { classifyIntent } from './intent.js';
import { buildContext, buildContextUpdate } from './context.js';
import { generateMcpToken } from '../mcp/auth.js';
import { getConversationProvider } from './conversation-provider.js';
import { getDecryptedConfig } from '../routes/connections.js';

const activeTurnControllers = new Map<string, AbortController>();

export function stopAgentTurn(sessionId: string): boolean {
  const ctrl = activeTurnControllers.get(sessionId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

export function getActiveSessionIds(): string[] {
  return Array.from(activeTurnControllers.keys());
}


function updateSessionSummary(sessionId: string): void {
  const messages = getDb()
    .prepare("SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(sessionId) as { role: string; content: string }[];

  if (messages.length === 0) return;

  // Build pairs from oldest to newest (messages are DESC, so reverse)
  const ordered = [...messages].reverse();
  const pairs: string[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const m = ordered[i];
    const next = ordered[i + 1];
    if (m.role === 'user' && next.role === 'assistant') {
      const q = m.content.trim().slice(0, 200).replace(/\n+/g, ' ');
      const a = next.content.trim().split(/\n{2,}/)[0]?.slice(0, 400).replace(/\n/g, ' ') ?? '';
      pairs.push(`- User: ${q}\n  Agent: ${a}`);
      i++; // skip the assistant message we just consumed
    }
  }

  if (pairs.length === 0) return;

  // Always keep the first pair (original goal) + the last 4 (recent context)
  const kept = pairs.length <= 5
    ? pairs
    : [pairs[0], ...pairs.slice(-4)];
  const summary = kept.join('\n');
  getDb().prepare('UPDATE sessions SET summary = ? WHERE id = ?').run(summary, sessionId);
}

function maybeGenerateSessionTitle(userId: string, sessionId: string): void {
  const session = getDb()
    .prepare('SELECT title FROM sessions WHERE id = ?')
    .get(sessionId) as { title: string | null } | undefined;
  if (!session || session.title) return;

  const firstUser = getDb()
    .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY created_at LIMIT 1")
    .get(sessionId) as { content: string } | undefined;
  if (!firstUser) return;

  const words = firstUser.content.trim().split(/\s+/);
  const title = words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '');
  getDb().prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, sessionId);
  broadcast(userId, { type: 'session_title_updated', sessionId, title });
}

type McpServerEntry = { url?: string; headers?: Record<string, string>; command?: string; args?: string[]; env?: Record<string, string> };

function getUserMcpServers(userId: string): Record<string, McpServerEntry> {
  const conns = getDb()
    .prepare("SELECT id, name FROM connections WHERE user_id = ? AND type = 'mcp' ORDER BY created_at")
    .all(userId) as { id: string; name: string }[];

  const servers: Record<string, McpServerEntry> = {};
  for (const conn of conns) {
    try {
      const cfg = getDecryptedConfig(conn.id, userId);
      const key = conn.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || conn.id;
      if (cfg.url) {
        servers[key] = { url: cfg.url, headers: cfg.headers ? JSON.parse(cfg.headers) : undefined };
      } else if (cfg.command) {
        servers[key] = {
          command: cfg.command,
          args: cfg.args ? JSON.parse(cfg.args) : undefined,
          env: cfg.env ? JSON.parse(cfg.env) : undefined,
        };
      }
    } catch { /* skip malformed connections */ }
  }
  return servers;
}

export async function runAgentTurn(userId: string, sessionId: string, userMessageId: string): Promise<void> {
  const provider = await getConversationProvider(userId);

  const session = getDb()
    .prepare('SELECT model, effort, provider_session_id FROM sessions WHERE id = ?')
    .get(sessionId) as { model: string | null; effort: string | null; provider_session_id: string | null } | undefined;

  const lastUserMsg = getDb()
    .prepare("SELECT id, content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1")
    .get(sessionId) as { id: string; content: string } | undefined;

  const prompt = lastUserMsg?.content ?? '';

  const attachments = lastUserMsg
    ? (getDb()
        .prepare('SELECT id, filename, mime_type as mimeType, storage_path as storagePath FROM message_attachments WHERE message_id = ? ORDER BY created_at, filename')
        .all(lastUserMsg.id) as { id: string; filename: string; mimeType: string; storagePath: string }[])
    : [];

  const attachmentBlock = attachments.length
    ? `\n\n<attachments>\n${attachments.map(a => `<file id="${a.id}" name="${a.filename}" path="${a.storagePath}" mime_type="${a.mimeType}" />`).join('\n')}\n</attachments>\n\nThe files above are available on disk. Use the Read tool to access text/code files. For binary files (PDF, images) that should be stored in an item, use attach_file_to_item with the file's path attribute.`
    : '';

  const intent = classifyIntent(prompt);
  const isResume = !!session?.provider_session_id;
  const systemPromptSuffix = isResume ? undefined : await buildContext(userId, sessionId, intent, prompt);
  const contextUpdate = isResume ? await buildContextUpdate(userId, sessionId, prompt) : undefined;
  const effectivePrompt = contextUpdate
    ? `<context>\n${contextUpdate}\n</context>\n\n${prompt}${attachmentBlock}`
    : `${prompt}${attachmentBlock}`;

  const port = process.env.PORT ?? '3000';
  const mcpToken = generateMcpToken(userId, sessionId);
  const mcpServers = {
    app: { url: `http://localhost:${port}/mcp`, headers: { Authorization: `Bearer ${mcpToken}` } },
    ...getUserMcpServers(userId),
  };

  const replyId = newId();
  const replyCreatedAt = Math.floor(Date.now() / 1000);
  let started = false;
  let fullText = '';

  const abortController = new AbortController();
  activeTurnControllers.get(sessionId)?.abort();
  activeTurnControllers.set(sessionId, abortController);

  let invokeResult: { costUsd?: number } = {};
  try {
    invokeResult = await provider.invoke({
      userId,
      prompt: effectivePrompt,
      resumeSessionId: session?.provider_session_id,
      systemPromptSuffix,
      mcpServers,
      model: session?.model ?? undefined,
      effort: session?.effort ?? undefined,
      signal: abortController.signal,
      onText: (delta) => {
        if (!started) {
          started = true;
          getDb()
            .prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)')
            .run(replyId, sessionId, 'assistant', '', replyCreatedAt);
          broadcast(userId, { type: 'message_started', sessionId, message: { id: replyId, role: 'assistant', content: '', created_at: replyCreatedAt } });
        }
        fullText += delta;
        broadcast(userId, { type: 'message_delta', sessionId, messageId: replyId, delta });
      },
      onSessionId: (id) => {
        setSessionProviderInfo(sessionId, provider.type, id);
      },
    });
  } catch (err) {
    const wasStopped = abortController.signal.aborted;
    if (started) {
      if (fullText) {
        getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(fullText, replyId);
        broadcast(userId, { type: 'message_created', sessionId, message: { id: replyId, role: 'assistant', content: fullText, created_at: replyCreatedAt } });
      } else {
        getDb().prepare('DELETE FROM messages WHERE id = ?').run(replyId);
      }
    }
    if (wasStopped) {
      getDb()
        .prepare("UPDATE session_turns SET status = 'done', completed_at = unixepoch() WHERE session_id = ? AND user_message_id = ? AND status = 'running'")
        .run(sessionId, userMessageId);
      broadcast(userId, { type: 'turn_complete', sessionId, status: 'stopped' });
      return;
    }
    throw err;
  } finally {
    activeTurnControllers.delete(sessionId);
  }

  if (fullText) {
    getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(fullText, replyId);
    broadcast(userId, { type: 'message_created', sessionId, message: { id: replyId, role: 'assistant', content: fullText, created_at: replyCreatedAt } });
  }

  getDb()
    .prepare("UPDATE session_turns SET status = 'done', completed_at = unixepoch() WHERE session_id = ? AND user_message_id = ? AND status = 'running'")
    .run(sessionId, userMessageId);
  getDb().prepare('UPDATE sessions SET updated_at = unixepoch() WHERE id = ?').run(sessionId);
  broadcast(userId, { type: 'turn_complete', sessionId, status: 'done' });

  try { recordAgentUsage(userId, provider.type as AgentUsageTool, invokeResult.costUsd ?? 0); } catch (e) { console.error('[postTurn:recordUsage]', e); }
  try { maybeGenerateSessionTitle(userId, sessionId); } catch (e) { console.error('[postTurn:title]', e); }
  try { updateSessionSummary(sessionId); } catch (e) { console.error('[postTurn:summary]', e); }
}
