import Anthropic from '@anthropic-ai/sdk';
import { getDb, getProjectForUser, setAgentWorktreeSession, updateCampaignTaskStatus, maybeCompleteCampaign, getCampaignForTask } from '../db/index.js';
import { runAgentPipeline, type AgentPipelineCtx } from './agent_pipeline.js';
import { ensureWorktree } from '../lib/worktree.js';
import { getDecryptedConfig } from '../routes/connections.js';
import { createExecution, completeExecution, appendOutput } from './executor.js';
import { runGitOp } from '../tools/git_op.js';
import { runGithubApi } from '../tools/github_api.js';
import { invokeClaudeCode } from '../tools/invoke_claude_code.js';
import { invokeCodex } from '../tools/invoke_codex.js';
import { callMcpTool } from '../tools/mcp_call.js';
import { runProjectQuery } from '../tools/project_query.js';
import { buildGraph } from './graphify.js';
import { remember, recall, forget } from '../tools/memory_tools.js';
import { readFile, listDir, writeFile } from '../tools/file_ops.js';
import { readChat } from '../tools/read_chat.js';
import { createProject, updateProject, deleteProject } from '../tools/project_ops.js';
import { runCreateCampaign } from '../tools/create_campaign.js';
import { broadcast } from './socket.js';
import { newId } from '../lib/ids.js';
import { DEFAULT_EFFORT, getAnthropicKey, resolveModelForTurn, listClaudeModels, type EffortLevel } from './anthropic.js';
import { extractIntent, DEFAULT_INTENT } from './intent.js';
import { buildContext, getToolSubset } from './context.js';
import { extractAndRemember } from './extract-memory.js';
import { renderVideo, type VideoScene } from './video.js';
import { createTextArtifact } from './artifacts.js';
import { maybeDistill } from './distill.js';

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

function startCampaignTask(userId: string, taskId: string, executionId: string): void {
  updateCampaignTaskStatus(taskId, 'running', executionId);
  broadcast(userId, { type: 'campaign_task_updated', taskId, status: 'running' });
}

function finishCampaignTask(userId: string, taskId: string, result: string): void {
  const status = result.startsWith('Error') ? 'error' : 'done';
  updateCampaignTaskStatus(taskId, status);
  const taskRow = getDb()
    .prepare('SELECT campaign_id FROM campaign_tasks WHERE id = ?')
    .get(taskId) as { campaign_id: string } | undefined;
  if (taskRow) maybeCompleteCampaign(taskRow.campaign_id);
  broadcast(userId, { type: 'campaign_task_updated', taskId, status });
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

  const campaignTaskId = toolInput.campaign_task_id as string | undefined;
  if (campaignTaskId) {
    const campaign = getCampaignForTask(campaignTaskId);
    if (campaign?.status === 'cancelled') {
      completeExecution(executionId, userId, 'error', 'Campaign cancelled');
      return 'Error: Campaign was cancelled';
    }
  }

  try {
    let result: string;
    let asyncExecution = false;

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
        if (ccTaskId) startCampaignTask(userId, ccTaskId, executionId);
        let ccGraphKey: string | null = null;
        try { ccGraphKey = getAnthropicKey(userId); } catch { /* none configured */ }
        const ccCtx: AgentPipelineCtx = { userId, tool: 'claude_code', repoPath: project.repo_path, projectId: project.id, graphKey: ccGraphKey };
        await runAgentPipeline(ccCtx, async () => {
          const ccResult = await invokeClaudeCode(
            { prompt: toolInput.prompt as string, model: toolInput.model as string | undefined },
            { userId, executionId, repoPath: ccWorktree.worktree_path, apiKey: ccApiKey, resumeSessionId: ccWorktree.claude_session_id, mcpServers: getMcpServersForUser(userId) }
          );
          if (ccResult.sessionId) setAgentWorktreeSession(ccWorktree.id, 'claude', ccResult.sessionId);
          ccCtx.result = ccResult.result;
          ccCtx.costUsd = ccResult.costUsd;
        });
        result = ccCtx.result!;
        if (ccTaskId) finishCampaignTask(userId, ccTaskId, result);
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
        if (codexTaskId) startCampaignTask(userId, codexTaskId, executionId);
        let codexGraphKey: string | null = null;
        try { codexGraphKey = getAnthropicKey(userId); } catch { /* none configured */ }
        const codexCtx: AgentPipelineCtx = { userId, tool: 'codex', repoPath: project.repo_path, projectId: project.id, graphKey: codexGraphKey };
        await runAgentPipeline(codexCtx, async () => {
          const codexResult = await invokeCodex(
            { prompt: toolInput.prompt as string, model: toolInput.model as string | undefined },
            { userId, executionId, repoPath: codexWorktree.worktree_path, apiKey: codexApiKey, resumeSessionId: codexWorktree.codex_session_id, mcpServers: getMcpServersForUser(userId) }
          );
          if (codexResult.sessionId) setAgentWorktreeSession(codexWorktree.id, 'codex', codexResult.sessionId);
          codexCtx.result = codexResult.result;
          codexCtx.costUsd = codexResult.costUsd;
        });
        result = codexCtx.result!;
        if (codexTaskId) finishCampaignTask(userId, codexTaskId, result);
        break;
      }
      case 'github_api': {
        const ghConn = getDb()
          .prepare("SELECT id FROM connections WHERE user_id = ? AND type = 'github' LIMIT 1")
          .get(userId) as { id: string } | undefined;
        const token = ghConn ? getDecryptedConfig(ghConn.id).token ?? '' : '';
        const ghTaskId = toolInput.campaign_task_id as string | undefined;
        if (ghTaskId) startCampaignTask(userId, ghTaskId, executionId);
        result = await runGithubApi(toolInput as unknown as Parameters<typeof runGithubApi>[0], { userId, executionId, token });
        if (ghTaskId) finishCampaignTask(userId, ghTaskId, result);
        break;
      }
      case 'mcp_call': {
        const mcpConfig = getDecryptedConfig(toolInput.connection_id as string);
        const mcpTaskId = toolInput.campaign_task_id as string | undefined;
        if (mcpTaskId) startCampaignTask(userId, mcpTaskId, executionId);
        result = await callMcpTool(
          toolInput.connection_id as string,
          mcpConfig.command,
          mcpConfig.args ? JSON.parse(mcpConfig.args) : [],
          mcpConfig.env ? JSON.parse(mcpConfig.env) : {},
          toolInput.tool_name as string,
          toolInput.tool_input as Record<string, unknown>,
        );
        if (mcpTaskId) finishCampaignTask(userId, mcpTaskId, result);
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
        const gitTaskId = toolInput.campaign_task_id as string | undefined;
        if (gitTaskId) startCampaignTask(userId, gitTaskId, executionId);
        result = await runGitOp(
          { op: toolInput.op as 'log' | 'diff' | 'status' | 'commit' | 'push', message: toolInput.message as string | undefined, branch: toolInput.branch as string | undefined ?? gitWorktree.branch },
          { userId, executionId, projectId, repoPath: gitWorktree.worktree_path }
        );
        if (gitTaskId) finishCampaignTask(userId, gitTaskId, result);
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
      case 'write_file': {
        const writeTaskId = toolInput.campaign_task_id as string | undefined;
        if (writeTaskId) startCampaignTask(userId, writeTaskId, executionId);
        result = await writeFile(
          { project_id: projectId, path: toolInput.path as string, content: toolInput.content as string },
          { userId, executionId, projectId, sessionId }
        );
        if (writeTaskId) finishCampaignTask(userId, writeTaskId, result);
        break;
      }
      case 'create_artifact': {
        const artifactTaskId = toolInput.campaign_task_id as string | undefined;
        if (artifactTaskId) startCampaignTask(userId, artifactTaskId, executionId);
        const artifact = await createTextArtifact({
          project_id: projectId,
          kind: toolInput.kind as string,
          title: toolInput.title as string,
          description: toolInput.description as string | undefined,
          content: toolInput.content as string,
          mime_type: toolInput.mime_type as 'text/markdown' | 'text/plain' | 'application/json' | undefined,
          status: toolInput.status as 'ready' | 'review' | 'running' | 'error' | undefined,
          source_task_id: artifactTaskId ?? null,
          metadata: { producer: 'create_artifact', execution_id: executionId },
        });
        result = JSON.stringify({ artifact_id: artifact.id, title: artifact.title, kind: artifact.kind });
        if (artifactTaskId) finishCampaignTask(userId, artifactTaskId, result);
        break;
      }
      case 'create_project':
        result = await createProject(
          {
            name: toolInput.name as string,
            description: toolInput.description as string | undefined,
            with_repo: toolInput.with_repo as boolean,
          },
          userId,
          executionId
        );
        break;
      case 'update_project':
        result = await updateProject(
          {
            project_id: toolInput.project_id as string,
            description: toolInput.description as string | undefined,
          },
          userId
        );
        break;
      case 'delete_project':
        result = await deleteProject({ project_id: toolInput.project_id as string, delete_files: toolInput.delete_files as boolean }, userId, executionId);
        break;
      case 'create_campaign': {
        result = runCreateCampaign(
          {
            project_id: toolInput.project_id as string,
            title: toolInput.title as string,
            tasks: toolInput.tasks as Array<{ title: string; agent: 'claude_code' | 'codex' | 'mcp' | 'file_write' | 'git' | 'github' }>,
            session_id: sessionId,
          },
          userId
        );
        break;
      }
      case 'generate_video': {
        const title = toolInput.title as string;
        const scenes = toolInput.scenes as VideoScene[];
        renderVideo(projectId, title, scenes, (progress) => {
          appendOutput(executionId, userId, `progress:${Math.round(progress * 100)}%\n`);
        })
          .then((fileName) => completeExecution(executionId, userId, 'done', `Rendered ${fileName}`))
          .catch((err) => completeExecution(executionId, userId, 'error', err instanceof Error ? err.message : String(err)));

        result = `Video render started (execution ${executionId}). It will appear in the project's Artifacts tab when done.`;
        asyncExecution = true;
        break;
      }
      default:
        result = `Unknown tool: ${toolName}`;
    }

    if (!asyncExecution) {
      completeExecution(executionId, userId, 'done', result);
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    completeExecution(executionId, userId, 'error', msg);
    const catchTaskId = toolInput.campaign_task_id as string | undefined;
    if (catchTaskId) finishCampaignTask(userId, catchTaskId, `Error: ${msg}`);
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
    .prepare('SELECT effort, model, summary FROM sessions WHERE id = ?')
    .get(sessionId) as { effort: EffortLevel; model: string | null; summary: string | null } | undefined;
  const effort = session?.effort ?? DEFAULT_EFFORT;

  const history = getDb()
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at')
    .all(sessionId) as DbMessage[];

  const lastUserMsg = [...history].reverse().find(m => m.role === 'user')?.content ?? '';

  const [intent] = await Promise.all([
    extractIntent(lastUserMsg, apiKey).catch(() => ({ ...DEFAULT_INTENT })),
    listClaudeModels(userId).catch(() => {}),
  ]);

  const model = session?.model ?? await resolveModelForTurn(client, intent, effort, apiKey);

  const systemPrompt = buildContext(userId, sessionId, intent);
  const tools = getToolSubset(intent);

  // When a session summary exists, use a sliding window of the last 20 messages
  // to keep context bounded; prepend the summary as a synthetic exchange.
  const windowedHistory = session?.summary
    ? history.slice(-20)
    : history;

  const messages: Anthropic.MessageParam[] = windowedHistory.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  if (session?.summary && messages.length > 0) {
    messages.unshift(
      { role: 'assistant', content: `Session context noted.` },
      { role: 'user', content: `Earlier in this session: ${session.summary}` },
    );
  }

  let currentMessages = [...messages];

  const replyId = newId();
  let fullText = '';
  let started = false;

  try {
    while (true) {
      const stream = client.messages.stream({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        tools: tools,
        messages: currentMessages,
      }, {
        headers: { 'anthropic-beta': 'web-fetch-2025-09-10' },
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

  extractAndRemember(userId, sessionId, apiKey).catch(() => {});
  maybeDistill(userId, sessionId, apiKey).catch(() => {});
}
