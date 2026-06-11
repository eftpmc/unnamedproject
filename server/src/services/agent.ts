import Anthropic from '@anthropic-ai/sdk';
import { getDb, getProjectForUser, setAgentWorktreeSession, updateCampaignTaskStatus, maybeCompleteCampaign, type DbProject } from '../db/index.js';
import { ensureWorktree } from '../lib/worktree.js';
import { getDecryptedConfig } from '../routes/connections.js';
import { recallAll } from './memory.js';
import { toolDefinitions } from '../tools/definitions.js';
import { createExecution, completeExecution } from './executor.js';
import { runGitOp } from '../tools/git_op.js';
import { runGithubApi } from '../tools/github_api.js';
import { invokeClaudeCode } from '../tools/invoke_claude_code.js';
import { invokeCodex } from '../tools/invoke_codex.js';
import { callMcpTool } from '../tools/mcp_call.js';
import { runProjectQuery } from '../tools/project_query.js';
import { buildGraph } from './graphify.js';
import { remember, recall, forget, formatEntry } from '../tools/memory_tools.js';
import { readFile, listDir, writeFile } from '../tools/file_ops.js';
import { readChat } from '../tools/read_chat.js';
import { createProject, updateProject, deleteProject } from '../tools/project_ops.js';
import { runCreateCampaign } from '../tools/create_campaign.js';
import { broadcast } from './socket.js';
import { newId } from '../lib/ids.js';
import { DEFAULT_EFFORT, getAnthropicKey, resolveModelForEffort, type EffortLevel } from './anthropic.js';

async function maybeGenerateSessionTitle(userId: string, sessionId: string): Promise<void> {
  // Only generate if session has no title yet
  const session = getDb()
    .prepare('SELECT title FROM sessions WHERE id = ?')
    .get(sessionId) as { title: string | null } | undefined;
  if (!session || session.title) return;

  // Get the first user message
  const firstUser = getDb()
    .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY created_at LIMIT 1")
    .get(sessionId) as { content: string } | undefined;
  if (!firstUser) return;

  let apiKey: string;
  try {
    apiKey = getAnthropicKey(userId);
  } catch {
    return; // no key configured, skip silently
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 40,
      messages: [{
        role: 'user',
        content: `Write a short title (4-6 words) for a conversation that starts with this message. Reply with only the title, no quotes or punctuation:\n\n${firstUser.content.slice(0, 500)}`,
      }],
    });
    const title = response.content[0].type === 'text' ? response.content[0].text.trim() : null;
    if (!title) return;

    getDb().prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, sessionId);
    broadcast(userId, { type: 'session_title_updated', sessionId, title });
  } catch {
    // title generation is best-effort, never throw
  }
}

interface DbMessage { role: string; content: string; }

function getProjects(userId: string): DbProject[] {
  return getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM projects WHERE user_id = ?')
    .all(userId) as DbProject[];
}

function timeAgo(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff <= 0) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function getRecentChats(userId: string, currentSessionId: string): Array<{ id: string; title: string | null; updated_at: number }> {
  return getDb()
    .prepare('SELECT id, title, updated_at FROM sessions WHERE user_id = ? AND id != ? ORDER BY updated_at DESC LIMIT 10')
    .all(userId, currentSessionId) as Array<{ id: string; title: string | null; updated_at: number }>;
}

function buildSystemPrompt(userId: string, sessionId: string): string {
  const memory = recallAll(userId);
  const projects = getProjects(userId);
  const session = getDb()
    .prepare('SELECT pinned_project_id FROM sessions WHERE id = ?')
    .get(sessionId) as { pinned_project_id: string | null } | undefined;
  const pinnedProject = session?.pinned_project_id
    ? projects.find(p => p.id === session.pinned_project_id)
    : null;

  const memoryText = memory.length > 0
    ? `\n\nUser memory:\n${memory.map(e => `- ${formatEntry(userId, e)}`).join('\n')}`
    : '\n\nUser memory:\nNo memories stored yet.';
  const pinnedProjectText = pinnedProject
    ? (() => {
        const isCode = !!pinnedProject.repo_path;
        const header = `\n\nActive project: **${pinnedProject.name}** (id: ${pinnedProject.id})${pinnedProject.description ? ' — ' + pinnedProject.description : ''}`;
        const guidance = isCode
          ? `\nThis is a code project (repo: ${pinnedProject.repo_path}). For coding tasks, delegate to invoke_claude_code or invoke_codex — give them rich context. Use git_op add→commit after work completes. For non-code tasks within this project (docs, notes), use write_file/read_file.`
          : `\nThis is a doc/writing project (no git repo). Use write_file/read_file/list_dir directly — no Claude Code or Codex needed. Create files in this project for any output the user wants saved.`;
        return header + guidance;
      })()
    : '';
  const projectsText = projects.length > 0
    ? `\n\nAvailable projects:\n${projects.map(p => `- ${p.name} (id: ${p.id}${p.repo_path ? '' : ', no repo'})${p.description ? ': ' + p.description : ''}`).join('\n')}`
    : '\n\nNo projects yet.';
  const recentChats = getRecentChats(userId, sessionId);
  const recentChatsText = recentChats.length > 0
    ? `\n\nRecent chats (use read_chat to retrieve full context when relevant):\n${recentChats.map(c => `- "${c.title ?? 'Untitled'}" (id: ${c.id}, ${timeAgo(c.updated_at)})`).join('\n')}`
    : '';

  return `You are a personal AI operator and orchestrator. You handle two types of tasks differently:

## Coding and technical work
For anything involving code, files, repos, or technical implementation:
- You are a delegator, not an implementer. Use invoke_claude_code or invoke_codex for all coding work.
- Figure out which project it belongs to. If none fits, call create_project (pick a sensible name, don't ask).
- Use project_query to understand the codebase before dispatching work.
- Give the coding agent a rich, detailed prompt — it can implement entire features, run tests, fix failures, refactor across files, install dependencies, and more. Don't hold back.
- After coding work completes, run git_op status to summarize what changed. To commit: run git_op add (stages everything), then git_op commit with a message. Then tell the user what was done and what branch it's on.
- invoke_claude_code and invoke_codex maintain context across calls — you can follow up, correct, or extend in subsequent calls.
- Prefer invoke_claude_code by default. Use invoke_codex for OpenAI preference or a second approach.

## Writing, creative, and conversational work
For writing, research, brainstorming, explaining, planning, answering questions, or anything non-technical:
- Respond directly. Do not use invoke_claude_code or invoke_codex.
- Use web_search for research. Use recall/remember for memory. Use read_chat for past context.
- For writing that should be saved to a file (a spec, a doc, a plan), use write_file — but confirm with the user first which project/path to use.

## Worktree isolation
All coding tools operate on an isolated git branch (separate per session). The user's main checkout is never touched — mistakes are contained and reversible.

## Approval tiers
- Auto-approved: invoke_claude_code, invoke_codex, git commit, create_project, update_project, project_query, read/list file ops
- User-approved (pauses): git push, write_file, github write ops, delete_project

Never skip a user-approved action — just proceed and the system handles the pause.
${pinnedProjectText}${memoryText}
${projectsText}${recentChatsText}`;
}

interface McpServerConfig { command: string; args?: string[]; env?: Record<string, string> }

function getMcpServersForUser(userId: string): Record<string, McpServerConfig> {
  const conns = getDb()
    .prepare("SELECT id FROM connections WHERE user_id = ? AND type = 'mcp'")
    .all(userId) as { id: string }[];
  const servers: Record<string, McpServerConfig> = {};
  for (const conn of conns) {
    try {
      const cfg = getDecryptedConfig(conn.id);
      if (cfg.command) {
        servers[conn.id] = {
          command: cfg.command,
          args: cfg.args ? JSON.parse(cfg.args) : [],
          env: cfg.env ? JSON.parse(cfg.env) : {},
        };
      }
    } catch { /* skip misconfigured connections */ }
  }
  return servers;
}

async function dispatchTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string,
  messageId: string,
  sessionId: string
): Promise<string> {
  const projectId = (toolInput.project_id as string | undefined) ?? 'unknown';
  const project = getProjectForUser(projectId, userId);
  const executionId = createExecution(userId, messageId, project?.id ?? null, toolName);

  try {
    let result: string;

    switch (toolName) {
      case 'invoke_claude_code': {
        if (!project) {
          result = `Error: project ${projectId} not found`;
          break;
        }
        if (!project.repo_path) {
          result = `Project '${project.name}' has no repo. Create a new repo-backed project with create_project (with_repo=true) for this work.`;
          break;
        }
        const connectionIds: string[] = JSON.parse(project.enabled_connection_ids ?? '[]');
        let ccApiKey: string | null = null;
        try { ccApiKey = getAnthropicKey(userId); } catch { /* use CLI's local auth */ }
        if (connectionIds.length > 0) {
          const anthropicConn = getDb()
            .prepare(`SELECT id FROM connections WHERE id IN (${connectionIds.map(() => '?').join(',')}) AND type = 'anthropic' LIMIT 1`)
            .get(...connectionIds) as { id: string } | undefined;
          if (anthropicConn) ccApiKey = getDecryptedConfig(anthropicConn.id).apiKey;
        }
        const ccWorktree = await ensureWorktree(project, sessionId);
        const ccTaskId = toolInput.campaign_task_id as string | undefined;
        if (ccTaskId) {
          updateCampaignTaskStatus(ccTaskId, 'running', executionId);
          broadcast(userId, { type: 'campaign_task_updated', taskId: ccTaskId, status: 'running' });
        }
        const ccResult = await invokeClaudeCode(
          { prompt: toolInput.prompt as string },
          { userId, executionId, repoPath: ccWorktree.worktree_path, apiKey: ccApiKey, resumeSessionId: ccWorktree.claude_session_id, mcpServers: getMcpServersForUser(userId) }
        );
        if (ccResult.sessionId) setAgentWorktreeSession(ccWorktree.id, 'claude', ccResult.sessionId);
        result = ccResult.result;
        if (ccTaskId) {
          const taskFinalStatus = result.startsWith('Error') ? 'error' : 'done';
          updateCampaignTaskStatus(ccTaskId, taskFinalStatus, executionId);
          const taskRow = getDb()
            .prepare('SELECT campaign_id FROM campaign_tasks WHERE id = ?')
            .get(ccTaskId) as { campaign_id: string } | undefined;
          if (taskRow) maybeCompleteCampaign(taskRow.campaign_id);
          broadcast(userId, { type: 'campaign_task_updated', taskId: ccTaskId, status: taskFinalStatus });
        }
        break;
      }
      case 'invoke_codex': {
        if (!project) {
          result = `Error: project ${projectId} not found`;
          break;
        }
        if (!project.repo_path) {
          result = `Project '${project.name}' has no repo. Create a new repo-backed project with create_project (with_repo=true) for this work.`;
          break;
        }
        const connectionIds: string[] = JSON.parse(project.enabled_connection_ids ?? '[]');
        let codexApiKey: string | null = null;
        if (connectionIds.length > 0) {
          const openaiConn = getDb()
            .prepare(`SELECT id FROM connections WHERE id IN (${connectionIds.map(() => '?').join(',')}) AND type = 'openai' LIMIT 1`)
            .get(...connectionIds) as { id: string } | undefined;
          if (openaiConn) codexApiKey = getDecryptedConfig(openaiConn.id).apiKey;
        }
        const codexWorktree = await ensureWorktree(project, sessionId);
        const codexTaskId = toolInput.campaign_task_id as string | undefined;
        if (codexTaskId) {
          updateCampaignTaskStatus(codexTaskId, 'running', executionId);
          broadcast(userId, { type: 'campaign_task_updated', taskId: codexTaskId, status: 'running' });
        }
        const codexResult = await invokeCodex(
          { prompt: toolInput.prompt as string },
          { userId, executionId, repoPath: codexWorktree.worktree_path, apiKey: codexApiKey, resumeSessionId: codexWorktree.codex_session_id, mcpServers: getMcpServersForUser(userId) }
        );
        if (codexResult.sessionId) setAgentWorktreeSession(codexWorktree.id, 'codex', codexResult.sessionId);
        result = codexResult.result;
        if (codexTaskId) {
          const taskFinalStatus = result.startsWith('Error') ? 'error' : 'done';
          updateCampaignTaskStatus(codexTaskId, taskFinalStatus, executionId);
          const taskRow = getDb()
            .prepare('SELECT campaign_id FROM campaign_tasks WHERE id = ?')
            .get(codexTaskId) as { campaign_id: string } | undefined;
          if (taskRow) maybeCompleteCampaign(taskRow.campaign_id);
          broadcast(userId, { type: 'campaign_task_updated', taskId: codexTaskId, status: taskFinalStatus });
        }
        break;
      }
      case 'github_api': {
        const ghConn = getDb()
          .prepare("SELECT id FROM connections WHERE user_id = ? AND type = 'github' LIMIT 1")
          .get(userId) as { id: string } | undefined;
        const token = ghConn ? getDecryptedConfig(ghConn.id).token ?? '' : '';
        result = await runGithubApi(toolInput as unknown as Parameters<typeof runGithubApi>[0], { userId, executionId, token });
        break;
      }
      case 'mcp_call': {
        const mcpConfig = getDecryptedConfig(toolInput.connection_id as string);
        result = await callMcpTool(
          toolInput.connection_id as string,
          mcpConfig.command,
          mcpConfig.args ? JSON.parse(mcpConfig.args) : [],
          mcpConfig.env ? JSON.parse(mcpConfig.env) : {},
          toolInput.tool_name as string,
          toolInput.tool_input as Record<string, unknown>,
        );
        break;
      }
      case 'git_op': {
        if (!project) {
          result = `Error: project ${projectId} not found`;
          break;
        }
        if (!project.repo_path) {
          result = `Project '${project.name}' has no repo. Create a new repo-backed project with create_project (with_repo=true) for this work.`;
          break;
        }
        const gitWorktree = await ensureWorktree(project, sessionId);
        result = await runGitOp(
          { op: toolInput.op as 'log' | 'diff' | 'status' | 'commit' | 'push', message: toolInput.message as string | undefined, branch: toolInput.branch as string | undefined ?? gitWorktree.branch },
          { userId, executionId, projectId, repoPath: gitWorktree.worktree_path }
        );
        break;
      }
      case 'project_query': {
        let pqKey: string | null = null;
        try { pqKey = getAnthropicKey(userId); } catch { /* none configured */ }
        result = await runProjectQuery({ project_id: projectId, question: toolInput.question as string }, userId, pqKey);
        break;
      }
      case 'rebuild_graph': {
        if (!project?.repo_path) {
          result = project ? `Project '${project.name}' has no repo.` : `Project ${projectId} not found.`;
          break;
        }
        let rgKey: string | null = null;
        try { rgKey = getAnthropicKey(userId); } catch { /* none configured */ }
        await buildGraph(project.repo_path, projectId, rgKey);
        result = 'Knowledge graph rebuilt successfully.';
        break;
      }
      case 'remember':
        result = remember(
          userId,
          toolInput.type as string,
          toolInput.key as string,
          toolInput.value as string,
          toolInput.project_id as string | undefined
        );
        break;
      case 'recall':
        result = recall(userId, toolInput.type as string | undefined, toolInput.key as string | undefined);
        break;
      case 'forget':
        result = forget(userId, toolInput.type as string, toolInput.key as string);
        break;
      case 'read_chat':
        result = readChat(userId, toolInput.chat_id as string);
        break;
      case 'read_file':
        result = await readFile({ project_id: projectId, path: toolInput.path as string }, { userId, executionId, projectId, sessionId });
        break;
      case 'list_dir':
        result = await listDir({ project_id: projectId, path: toolInput.path as string | undefined }, { userId, executionId, projectId, sessionId });
        break;
      case 'write_file':
        result = await writeFile(
          { project_id: projectId, path: toolInput.path as string, content: toolInput.content as string },
          { userId, executionId, projectId, sessionId }
        );
        break;
      case 'create_project':
        result = await createProject(
          { name: toolInput.name as string, description: toolInput.description as string | undefined, with_repo: toolInput.with_repo as boolean },
          userId,
          executionId
        );
        break;
      case 'update_project':
        result = await updateProject({ project_id: toolInput.project_id as string, description: toolInput.description as string }, userId);
        break;
      case 'delete_project':
        result = await deleteProject({ project_id: toolInput.project_id as string, delete_files: toolInput.delete_files as boolean }, userId, executionId);
        break;
      case 'create_campaign': {
        result = runCreateCampaign(
          {
            project_id: toolInput.project_id as string,
            title: toolInput.title as string,
            tasks: toolInput.tasks as Array<{ title: string; agent: 'claude_code' | 'codex' | 'mcp' }>,
            session_id: sessionId,
          },
          userId
        );
        break;
      }
      default:
        result = `Unknown tool: ${toolName}`;
    }

    completeExecution(executionId, userId, 'done', result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    completeExecution(executionId, userId, 'error', msg);
    return `Error: ${msg}`;
  }
}

export async function runAgentTurn(userId: string, sessionId: string, userMessageId: string): Promise<void> {
  let apiKey: string;
  try {
    apiKey = getAnthropicKey(userId);
  } catch {
    if (process.env.ANTHROPIC_API_KEY) {
      apiKey = process.env.ANTHROPIC_API_KEY;
    } else {
      throw new Error('No Anthropic API key configured. Add a connection in Settings or set ANTHROPIC_API_KEY in the environment.');
    }
  }
  const client = new Anthropic({ apiKey });

  const session = getDb()
    .prepare('SELECT effort, model FROM sessions WHERE id = ?')
    .get(sessionId) as { effort: EffortLevel; model: string | null } | undefined;
  const effort = session?.effort ?? DEFAULT_EFFORT;
  const model = session?.model || await resolveModelForEffort(client, effort, apiKey);

  const history = getDb()
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at')
    .all(sessionId) as DbMessage[];

  const messages: Anthropic.MessageParam[] = history.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const systemPrompt = buildSystemPrompt(userId, sessionId);
  let currentMessages = [...messages];

  const replyId = newId();
  let fullText = '';
  let started = false;

  try {
    while (true) {
      const stream = client.messages.stream({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        tools: toolDefinitions,
        messages: currentMessages,
      });

      stream.on('text', (delta) => {
        if (!started) {
          started = true;
          getDb()
            .prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
            .run(replyId, sessionId, 'assistant', '');
          broadcast(userId, { type: 'message_started', message: { id: replyId, role: 'assistant', content: '' } });
        }
        fullText += delta;
        broadcast(userId, { type: 'message_delta', messageId: replyId, delta });
      });

      const response = await stream.finalMessage();

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[];

        currentMessages.push({ role: 'assistant', content: response.content });

        // Dispatch all tool calls (potentially parallel for independent tools)
        const toolResults = await Promise.all(
          toolUseBlocks.map(async block => {
            const result = await dispatchTool(block.name, block.input as Record<string, unknown>, userId, userMessageId, sessionId);
            return {
              type: 'tool_result' as const,
              tool_use_id: block.id,
              content: result,
            };
          })
        );

        currentMessages.push({ role: 'user', content: toolResults });
        continue;
      }

      break;
    }
  } catch (err) {
    if (started) {
      // Persist whatever was streamed so far rather than leaving an empty
      // assistant message in history (the API rejects empty assistant content).
      if (fullText) {
        getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(fullText, replyId);
        broadcast(userId, { type: 'message_created', message: { id: replyId, role: 'assistant', content: fullText } });
      } else {
        getDb().prepare('DELETE FROM messages WHERE id = ?').run(replyId);
      }
    }
    throw err;
  }

  if (fullText) {
    getDb()
      .prepare('UPDATE messages SET content = ? WHERE id = ?')
      .run(fullText, replyId);
    broadcast(userId, { type: 'message_created', message: { id: replyId, role: 'assistant', content: fullText } });
  }

  getDb()
    .prepare('UPDATE sessions SET updated_at = unixepoch() WHERE id = ?')
    .run(sessionId);
  broadcast(userId, { type: 'turn_complete', sessionId });

  // Fire-and-forget: generate title after first turn
  maybeGenerateSessionTitle(userId, sessionId).catch(() => {});
}
