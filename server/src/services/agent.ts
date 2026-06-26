import fs from 'fs';
import path from 'path';
import { getDb, recordAgentUsage, setSessionProviderInfo, type AgentUsageTool } from '../db/index.js';
import { broadcast } from './socket.js';
import { newId } from '../lib/ids.js';
import { classifyIntent } from './intent.js';
import { buildContext } from './context.js';
import { generateMcpToken } from '../mcp/auth.js';
import { getConversationProvider } from './conversation-provider.js';
import { getItemsForSpace } from './items.js';

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

function checkpointWorkspaceMd(userId: string, sessionId: string, userPrompt: string, assistantReply: string): void {
  const session = getDb()
    .prepare('SELECT pinned_space_id, title FROM sessions WHERE id = ?')
    .get(sessionId) as { pinned_space_id: string | null; title: string | null } | undefined;
  if (!session?.pinned_space_id) return;

  const repoItems = getItemsForSpace(session.pinned_space_id)
    .filter(item => item.type === 'repo');
  if (repoItems.length === 0) return;

  const repoPath = repoItems[0].fields.repo_path as string;
  const workspacePath = path.join(repoPath, 'workspace.md');

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 16).replace('T', ' ');

  const promptSnippet = userPrompt.trim().slice(0, 200).replace(/\n+/g, ' ');
  // Take the first non-empty paragraph of the reply as the summary
  const replySnippet = assistantReply
    .split(/\n{2,}/)
    .map(p => p.trim())
    .find(p => p.length > 20)
    ?.slice(0, 400)
    .replace(/\n/g, ' ') ?? '';

  const entry = `\n\n---\n*${dateStr}*\n\n**${promptSnippet}${userPrompt.length > 200 ? '…' : ''}**\n${replySnippet}`;

  try {
    fs.appendFileSync(workspacePath, entry, 'utf8');
  } catch {
    // workspace.md may not exist yet — create it with a header
    try {
      fs.writeFileSync(workspacePath, `# Workspace Log${entry}`, 'utf8');
    } catch { /* repo path may not be writable */ }
  }
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

export async function runAgentTurn(userId: string, sessionId: string, userMessageId: string): Promise<void> {
  const provider = await getConversationProvider(userId);

  const session = getDb()
    .prepare('SELECT model, effort, provider_session_id FROM sessions WHERE id = ?')
    .get(sessionId) as { model: string | null; effort: string | null; provider_session_id: string | null } | undefined;

  const lastUserMsg = getDb()
    .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1")
    .get(sessionId) as { content: string } | undefined;

  const prompt = lastUserMsg?.content ?? '';
  const intent = classifyIntent(prompt);
  const systemPromptSuffix = await buildContext(userId, sessionId, intent, prompt);

  const port = process.env.PORT ?? '3000';
  const mcpToken = generateMcpToken(userId, sessionId);
  const mcpServers = {
    app: { url: `http://localhost:${port}/mcp`, headers: { Authorization: `Bearer ${mcpToken}` } },
  };

  const replyId = newId();
  const replyCreatedAt = Math.floor(Date.now() / 1000);
  let started = false;
  let fullText = '';

  const abortController = new AbortController();
  activeTurnControllers.set(sessionId, abortController);

  let invokeResult: { costUsd?: number } = {};
  try {
    invokeResult = await provider.invoke({
      userId,
      prompt,
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

  recordAgentUsage(userId, provider.type as AgentUsageTool, invokeResult.costUsd ?? 0);
  maybeGenerateSessionTitle(userId, sessionId);
  updateSessionSummary(sessionId);
  checkpointWorkspaceMd(userId, sessionId, prompt, fullText);
}
