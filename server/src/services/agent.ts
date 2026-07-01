import fs from 'fs/promises';
import path from 'path';
import { createSessionEvent, getDataDir, getDb, recordAgentUsage, setSessionProviderInfo, type AgentUsageTool } from '../db/index.js';
import { broadcast } from './socket.js';
import { newId } from '../lib/ids.js';
import { classifyIntent } from './intent.js';
import { buildContext, buildContextUpdate } from './context.js';
import { modeUsesProviderResume, selectInvocationMode } from './invocation-policy.js';
import { getSessionState, recordSessionStateEvent, updateSessionState } from './session-state.js';
import { generateMcpToken } from '../mcp/auth.js';
import { getConversationProvider } from './conversation-provider.js';

function isProviderLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('rate limit') || msg.includes('usage limit') || msg.includes('quota') || msg.includes('limit exceeded') || msg.includes('too many requests') || msg.includes('429');
}
import { getDecryptedConfig, touchConnection } from '../routes/connections.js';
import { ensureWorktree } from '../lib/worktree.js';

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

type McpServerEntry = { url?: string; headers?: Record<string, string>; command?: string; args?: string[]; env?: Record<string, string>; cwd?: string };

interface InvocationWorkspace {
  cwd: string;
  root: string;
  sessionRoot: string;
  sessionOutputsPath: string;
  projectRoot?: string;
  projectFilesPath?: string;
  projectRepoPath?: string;
}


function getProjectEnabledMcpConnectionIds(userId: string, sessionId: string): Set<string> {
  const row = getDb()
    .prepare(`
      SELECT p.enabled_connection_ids
      FROM sessions s
      JOIN projects p ON p.id = s.pinned_project_id AND p.user_id = s.user_id
      WHERE s.id = ? AND s.user_id = ?
    `)
    .get(sessionId, userId) as { enabled_connection_ids: string } | undefined;
  if (!row) return new Set();
  try {
    const parsed = JSON.parse(row.enabled_connection_ids || '[]') as unknown;
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function getUserMcpServers(userId: string, enabledConnectionIds: Set<string>): Record<string, McpServerEntry> {
  if (enabledConnectionIds.size === 0) return {};
  const placeholders = Array.from(enabledConnectionIds).map(() => '?').join(',');
  const conns = getDb()
    .prepare(`SELECT id, name FROM connections WHERE user_id = ? AND type = 'mcp' AND id IN (${placeholders}) ORDER BY created_at`)
    .all(userId, ...Array.from(enabledConnectionIds)) as { id: string; name: string }[];

  const servers: Record<string, McpServerEntry> = {};
  for (const conn of conns) {
    try {
      const cfg = getDecryptedConfig(conn.id, userId);
      const key = conn.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || conn.id;
      if (cfg.url) {
        servers[key] = { url: cfg.url, headers: cfg.headers ? JSON.parse(cfg.headers) : undefined };
        touchConnection(conn.id);
      } else if (cfg.command) {
        servers[key] = {
          command: cfg.command,
          args: cfg.args ? JSON.parse(cfg.args) : undefined,
          env: cfg.env ? JSON.parse(cfg.env) : undefined,
          cwd: cfg.cwd,
        };
        touchConnection(conn.id);
      }
    } catch { /* skip malformed connections */ }
  }
  return servers;
}

async function replaceSymlink(linkPath: string, targetPath: string): Promise<void> {
  try { await fs.unlink(linkPath); } catch { /* not present */ }
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  await fs.symlink(targetPath, linkPath, 'dir');
}

async function ensureSessionWorkspace(root: string): Promise<{ sessionRoot: string; sessionOutputsPath: string }> {
  const sessionRoot = path.join(root, 'session');
  const sessionOutputsPath = path.join(sessionRoot, 'outputs');
  await fs.mkdir(path.join(sessionRoot, 'scratch'), { recursive: true });
  await fs.mkdir(path.join(sessionRoot, 'downloads'), { recursive: true });
  await fs.mkdir(sessionOutputsPath, { recursive: true });
  return { sessionRoot, sessionOutputsPath };
}

async function prepareInvocationWorkspace(sessionId: string): Promise<InvocationWorkspace> {
  const root = path.resolve(getDataDir(), 'agent-workspaces', sessionId);
  await fs.mkdir(root, { recursive: true });
  const { sessionRoot, sessionOutputsPath } = await ensureSessionWorkspace(root);

  const session = getDb()
    .prepare('SELECT pinned_project_id FROM sessions WHERE id = ?')
    .get(sessionId) as { pinned_project_id: string | null } | undefined;
  const pinnedProjectId = session?.pinned_project_id;
  if (!pinnedProjectId) return { cwd: root, root, sessionRoot, sessionOutputsPath };

  const project = getDb()
    .prepare('SELECT id, repo_path, files_path FROM projects WHERE id = ?')
    .get(pinnedProjectId) as { id: string; repo_path: string; files_path: string } | undefined;
  if (!project) return { cwd: root, root, sessionRoot, sessionOutputsPath };

  const projectRoot = path.join(root, 'project');
  await fs.mkdir(projectRoot, { recursive: true });

  if (project.files_path) {
    await fs.mkdir(project.files_path, { recursive: true });
    await replaceSymlink(path.join(projectRoot, 'files'), project.files_path);
  }

  let projectRepoPath: string | undefined;
  if (project.repo_path) {
    const ensured = await ensureWorktree({ id: project.id, fields: { repo_path: project.repo_path } }, sessionId);
    projectRepoPath = ensured.worktree_path;
  }
  if (projectRepoPath) {
    await replaceSymlink(path.join(projectRoot, 'repo'), projectRepoPath);
  }

  return {
    cwd: root,
    root,
    sessionRoot,
    sessionOutputsPath,
    projectRoot,
    projectFilesPath: project.files_path ? path.join(projectRoot, 'files') : undefined,
    projectRepoPath: projectRepoPath ? path.join(projectRoot, 'repo') : undefined,
  };
}

function emitRuntimeCheckpoint(
  userId: string,
  sessionId: string,
  title: string,
  body: string | null,
  metadata: Record<string, unknown>,
): void {
  const event = createSessionEvent({
    sessionId,
    type: 'runtime_checkpoint',
    title,
    body,
    metadata,
  });
  broadcast(userId, {
    type: 'session_event_created',
    sessionId,
    event: { ...event, metadata: JSON.parse(event.metadata || '{}') },
  });
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
  const turn = getDb()
    .prepare("SELECT id FROM session_turns WHERE session_id = ? AND user_message_id = ? ORDER BY started_at DESC LIMIT 1")
    .get(sessionId, userMessageId) as { id: string } | undefined;
  const messageCount = (getDb()
    .prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?')
    .get(sessionId) as { count: number }).count;

  const uploads = lastUserMsg
    ? (getDb()
        .prepare('SELECT f.id, f.title, f.mime_type as mimeType FROM message_files mf JOIN files f ON f.id = mf.document_id WHERE mf.message_id = ? ORDER BY f.created_at, f.title')
        .all(lastUserMsg.id) as { id: string; title: string; mimeType: string }[])
    : [];

  const attachmentBlock = uploads.length
    ? `\n\n<uploads>\n${uploads.map(u => `<file id="${u.id}" title="${u.title}" mime_type="${u.mimeType}" />`).join('\n')}\n</uploads>\n\nThe files above were just uploaded to the library. Use read_file to access text/code files, or tag_file to add metadata.`
    : '';

  const sessionCostRow = getDb()
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM agent_usage WHERE session_id = ?')
    .get(sessionId) as { total: number };

  const currentState = getSessionState(sessionId);
  const intent = classifyIntent(prompt);
  const invocationMode = selectInvocationMode({
    providerSessionId: session?.provider_session_id,
    prompt,
    messageCount,
    sessionCostUsd: sessionCostRow.total,
    blockers: currentState.blockers,
  });
  const isResume = modeUsesProviderResume(invocationMode);
  if (turn) {
    getDb()
      .prepare('UPDATE session_turns SET invocation_mode = ?, provider_type = ?, provider_session_id = ? WHERE id = ?')
      .run(invocationMode, provider.type, isResume ? (session?.provider_session_id ?? null) : null, turn.id);
  }
  // Only show a divider when the agent starts fresh — resuming is the expected path
  // and showing a divider on every turn creates noise.
  if (!isResume && session?.provider_session_id) {
    emitRuntimeCheckpoint(
      userId,
      sessionId,
      'Started fresh from checkpoint',
      'The agent kept the visible chat but started a new provider session from saved state.',
      { invocationMode, providerType: provider.type },
    );
  }
  const systemPromptSuffix = isResume ? undefined : await buildContext(userId, sessionId, intent, prompt);
  const contextUpdate = isResume ? await buildContextUpdate(userId, sessionId, prompt) : undefined;
  const effectivePrompt = contextUpdate
    ? `<context>\n${contextUpdate}\n</context>\n\n${prompt}${attachmentBlock}`
    : `${prompt}${attachmentBlock}`;

  const port = process.env.PORT ?? '3000';
  const mcpToken = generateMcpToken(userId, sessionId);
  const enabledMcpConnectionIds = getProjectEnabledMcpConnectionIds(userId, sessionId);
  const mcpServers = {
    app: { url: `http://localhost:${port}/mcp`, headers: { Authorization: `Bearer ${mcpToken}` } },
    ...getUserMcpServers(userId, enabledMcpConnectionIds),
  };
  const workspace = await prepareInvocationWorkspace(sessionId);

  const replyId = newId();
  const replyCreatedAt = Math.floor(Date.now() / 1000);
  let started = false;
  let fullText = '';

  const abortController = new AbortController();
  activeTurnControllers.get(sessionId)?.abort();
  activeTurnControllers.set(sessionId, abortController);

  let invokeResult: { costUsd?: number; executionId?: string } = {};
  const onText = (delta: string) => {
    if (!started) {
      started = true;
      getDb()
        .prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)')
        .run(replyId, sessionId, 'assistant', '', replyCreatedAt);
      broadcast(userId, { type: 'message_started', sessionId, message: { id: replyId, role: 'assistant', content: '', created_at: replyCreatedAt } });
    }
    fullText += delta;
    getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(fullText, replyId);
    broadcast(userId, { type: 'message_delta', sessionId, messageId: replyId, delta });
  };
  const onSessionId = (id: string) => { setSessionProviderInfo(sessionId, provider.type, id); };

  const doInvoke = (resumeSessionId: string | null) => provider.invoke({
    userId, messageId: userMessageId, repoPath: workspace.cwd, prompt: effectivePrompt, resumeSessionId, systemPromptSuffix, mcpServers,
    model: session?.model ?? undefined, effort: session?.effort ?? undefined,
    signal: abortController.signal, onText, onSessionId,
  });

  try {
    try {
      invokeResult = await doInvoke(isResume ? (session?.provider_session_id ?? null) : null);
    } catch (firstErr) {
      const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      if (msg.includes('no rollout found') && session?.provider_session_id) {
        getDb().prepare('UPDATE sessions SET provider_session_id = NULL WHERE id = ?').run(sessionId);
        invokeResult = await doInvoke(null);
      } else {
        throw firstErr;
      }
    }
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
      try {
        recordSessionStateEvent(sessionId, {
          open_tasks: ['User stopped the active agent turn before completion.'],
          next_action: 'Wait for the user to clarify whether to continue from the checkpoint.',
        });
      } catch (e) { console.error('[stopTurn:sessionState]', e); }
      try {
        emitRuntimeCheckpoint(userId, sessionId, 'Turn stopped', 'The user stopped the active agent turn before completion.', {
          invocationMode,
          providerType: provider.type,
        });
      } catch (e) { console.error('[stopTurn:event]', e); }
      broadcast(userId, { type: 'turn_complete', sessionId, status: 'stopped' });
      return;
    }
    if (isProviderLimitError(err)) {
      getDb()
        .prepare('UPDATE sessions SET provider_session_id = NULL WHERE id = ?')
        .run(sessionId);
      try {
        recordSessionStateEvent(sessionId, {
          blockers: ['Provider session hit a usage/rate/session limit. Hidden provider context was reset.'],
          open_tasks: ['Continue from structured session state instead of resuming the exhausted provider session.'],
          next_action: 'Start a fresh provider session with the saved session state.',
        });
      } catch (e) { console.error('[limitError:sessionState]', e); }
      try {
        emitRuntimeCheckpoint(userId, sessionId, 'Provider session reset', 'The provider reported a usage/session limit. Hidden provider context was cleared; future turns can continue from saved state.', {
          invocationMode,
          providerType: provider.type,
          reason: 'provider_limit',
        });
      } catch (e) { console.error('[limitError:event]', e); }
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

  try {
    recordAgentUsage(userId, provider.type as AgentUsageTool, invokeResult.costUsd ?? 0, {
      sessionId,
      turnId: turn?.id ?? null,
      messageId: userMessageId,
      executionId: invokeResult.executionId ?? null,
    });
  } catch (e) { console.error('[postTurn:recordUsage]', e); }
  try { updateSessionState(sessionId); } catch (e) { console.error('[postTurn:sessionState]', e); }
  try { maybeGenerateSessionTitle(userId, sessionId); } catch (e) { console.error('[postTurn:title]', e); }
  try { updateSessionSummary(sessionId); } catch (e) { console.error('[postTurn:summary]', e); }
}
