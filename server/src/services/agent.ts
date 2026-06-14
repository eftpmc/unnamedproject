import Anthropic from '@anthropic-ai/sdk';
import { createSessionEvent, getDb, getProjectForUser, linkSessionProject, setAgentWorktreeSession, updateCampaignTaskStatus, maybeCompleteCampaign, getCampaignForTask, getCampaignSummaries, getCampaignById, getCampaignTasks, getExecutionById, getScheduledTasksForUser, createScheduledTask, updateScheduledTask, deleteScheduledTask, resumeCampaign, getPermissionProfile } from '../db/index.js';
import { runAgentPipeline, type AgentPipelineCtx } from './agent_pipeline.js';
import { ensureWorktree } from '../lib/worktree.js';
import { getDecryptedConfig } from '../routes/connections.js';
import { createExecution, completeExecution, appendOutput, requestApproval } from './executor.js';
import { runGitOp } from '../tools/git_op.js';
import { runGithubApi } from '../tools/github_api.js';
import { invokeClaudeCode } from '../tools/invoke_claude_code.js';
import { invokeCodex } from '../tools/invoke_codex.js';
import { callMcpTool } from '../tools/mcp_call.js';
import { runProjectQuery } from '../tools/project_query.js';
import { buildGraph } from './graphify.js';
import { remember, recall, forget } from '../tools/memory_tools.js';
import { readFile, listDir, writeFile, searchFiles } from '../tools/file_ops.js';
import { readChat } from '../tools/read_chat.js';
import { createProject, updateProject, deleteProject } from '../tools/project_ops.js';
import { runCreateCampaign } from '../tools/create_campaign.js';
import { broadcast } from './socket.js';
import { newId } from '../lib/ids.js';
import { DEFAULT_EFFORT, getAnthropicKey, resolveModelForTurn, listClaudeModels, type EffortLevel } from './anthropic.js';
import { classifyIntent } from './intent.js';
import { buildContext } from './context.js';
import { toolDefinitions } from '../tools/definitions.js';
import { extractAndRemember } from './extract-memory.js';
import { renderVideo, type VideoScene } from './video.js';
import { createTextArtifact, listProjectArtifacts, getArtifactById, readArtifactContent, registerFileAsArtifact } from './artifacts.js';
import { listMcpTools } from '../lib/mcp-pool.js';
import { maybeDistill } from './distill.js';

function buildCampaignPriorContext(campaignTaskId: string): string | null {
  const campaign = getCampaignForTask(campaignTaskId);
  if (!campaign) return null;

  const currentTask = getDb()
    .prepare('SELECT position FROM campaign_tasks WHERE id = ?')
    .get(campaignTaskId) as { position: number } | undefined;
  if (!currentTask) return null;

  const priorTasks = getDb()
    .prepare(`
      SELECT ct.title, ct.execution_id
      FROM campaign_tasks ct
      WHERE ct.campaign_id = ? AND ct.position < ? AND ct.status = 'done'
      ORDER BY ct.position
    `)
    .all(campaign.id, currentTask.position) as Array<{ title: string; execution_id: string | null }>;

  if (priorTasks.length === 0) return null;

  const MAX_RESULT_CHARS = 2000;
  const parts = priorTasks.map(t => {
    if (!t.execution_id) return `### ${t.title}\n(no output recorded)`;
    const ex = getExecutionById(t.execution_id);
    if (!ex?.result) return `### ${t.title}\n(no output recorded)`;
    const result = ex.result.length > MAX_RESULT_CHARS
      ? ex.result.slice(0, MAX_RESULT_CHARS) + '\n…(truncated)'
      : ex.result;
    return `### ${t.title}\n${result}`;
  });

  return `## Prior campaign task results\nCampaign: "${campaign.title}"\n\n${parts.join('\n\n')}`;
}

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
      const cfg = getDecryptedConfig(conn.id, userId);
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

const PARALLEL_SAFE_TOOLS = new Set([
  'recall',
  'list_chats',
  'read_chat',
  'list_artifacts',
  'read_artifact',
  'list_connections',
  'test_connection',
  'search_files',
  'read_file',
  'list_dir',
  'project_query',
  'list_campaigns',
  'get_campaign',
  'get_execution_output',
  'list_scheduled_tasks',
]);

function noteProjectUse(userId: string, sessionId: string, project: { id: string; name: string }, executionId?: string): void {
  const linked = linkSessionProject(sessionId, project.id, 'agent');
  if (!linked) return;
  const event = createSessionEvent({
    sessionId,
    type: 'project_linked',
    title: `Scoped to ${project.name}`,
    body: 'The agent attached this chat to a project automatically.',
    projectId: project.id,
    executionId: executionId ?? null,
    metadata: { source: 'agent' },
  });
  broadcast(userId, {
    type: 'session_event_created',
    sessionId,
    event: { ...event, metadata: JSON.parse(event.metadata || '{}') },
  });
}

async function dispatchToolBlocks(
  toolUseBlocks: Anthropic.ToolUseBlock[],
  userId: string,
  userMessageId: string,
  sessionId: string,
): Promise<Anthropic.ToolResultBlockParam[]> {
  const runBlock = async (block: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> => {
    const result = await dispatchTool(block.name, block.input as Record<string, unknown>, userId, userMessageId, sessionId);
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: result,
    };
  };

  if (toolUseBlocks.every(block => PARALLEL_SAFE_TOOLS.has(block.name))) {
    return Promise.all(toolUseBlocks.map(runBlock));
  }

  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const block of toolUseBlocks) {
    results.push(await runBlock(block));
  }
  return results;
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
  if (project) noteProjectUse(userId, sessionId, project, executionId);

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
          if (anthropicConn) ccApiKey = getDecryptedConfig(anthropicConn.id, userId).apiKey;
        }
        const ccWorktree = await ensureWorktree(project, sessionId);
        const ccTaskId = toolInput.campaign_task_id as string | undefined;
        if (ccTaskId) startCampaignTask(userId, ccTaskId, executionId);
        let ccGraphKey: string | null = null;
        try { ccGraphKey = getAnthropicKey(userId); } catch { /* none configured */ }
        const ccCtx: AgentPipelineCtx = { userId, tool: 'claude_code', repoPath: project.repo_path, projectId: project.id, graphKey: ccGraphKey };
        const ccPrior = ccTaskId ? buildCampaignPriorContext(ccTaskId) : null;
        const ccPrompt = ccPrior ? `${toolInput.prompt as string}\n\n${ccPrior}` : toolInput.prompt as string;
        await runAgentPipeline(ccCtx, async () => {
          const ccResult = await invokeClaudeCode(
            { prompt: ccPrompt, model: toolInput.model as string | undefined },
            { userId, executionId, repoPath: ccWorktree.worktree_path, apiKey: ccApiKey, resumeSessionId: ccWorktree.claude_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId) }
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
          if (openaiConn) codexApiKey = getDecryptedConfig(openaiConn.id, userId).apiKey;
        }
        const codexWorktree = await ensureWorktree(project, sessionId);
        const codexTaskId = toolInput.campaign_task_id as string | undefined;
        if (codexTaskId) startCampaignTask(userId, codexTaskId, executionId);
        let codexGraphKey: string | null = null;
        try { codexGraphKey = getAnthropicKey(userId); } catch { /* none configured */ }
        const codexCtx: AgentPipelineCtx = { userId, tool: 'codex', repoPath: project.repo_path, projectId: project.id, graphKey: codexGraphKey };
        const codexPrior = codexTaskId ? buildCampaignPriorContext(codexTaskId) : null;
        const codexPrompt = codexPrior ? `${toolInput.prompt as string}\n\n${codexPrior}` : toolInput.prompt as string;
        await runAgentPipeline(codexCtx, async () => {
          const codexResult = await invokeCodex(
            { prompt: codexPrompt, model: toolInput.model as string | undefined },
            { userId, executionId, repoPath: codexWorktree.worktree_path, apiKey: codexApiKey, resumeSessionId: codexWorktree.codex_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId) }
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
        const token = ghConn ? getDecryptedConfig(ghConn.id, userId).token ?? '' : '';
        const ghTaskId = toolInput.campaign_task_id as string | undefined;
        if (ghTaskId) startCampaignTask(userId, ghTaskId, executionId);
        result = await runGithubApi(toolInput as unknown as Parameters<typeof runGithubApi>[0], { userId, executionId, token });
        if (ghTaskId) finishCampaignTask(userId, ghTaskId, result);
        break;
      }
      case 'mcp_call': {
        const mcpConn = getDb()
          .prepare("SELECT id FROM connections WHERE id = ? AND user_id = ? AND type = 'mcp'")
          .get(toolInput.connection_id as string, userId) as { id: string } | undefined;
        if (!mcpConn) {
          result = `Error: MCP connection ${toolInput.connection_id as string} not found`;
          break;
        }
        const mcpConfig = getDecryptedConfig(mcpConn.id, userId);
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
      case 'list_chats': {
        const limit = Math.min(100, (toolInput.limit as number | undefined) ?? 20);
        const filterProject = toolInput.project_id as string | undefined;
        const rows = filterProject
          ? getDb().prepare('SELECT id, title, updated_at, pinned_project_id FROM sessions WHERE user_id = ? AND pinned_project_id = ? ORDER BY updated_at DESC LIMIT ?').all(userId, filterProject, limit)
          : getDb().prepare('SELECT id, title, updated_at, pinned_project_id FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?').all(userId, limit);
        result = JSON.stringify(rows, null, 2);
        break;
      }
      case 'read_chat':
        result = readChat(userId, toolInput.chat_id as string);
        break;
      case 'register_artifact': {
        const regTaskId = toolInput.campaign_task_id as string | undefined;
        if (regTaskId) startCampaignTask(userId, regTaskId, executionId);
        const art = await registerFileAsArtifact({
          project_id: toolInput.project_id as string,
          source_path: toolInput.file_path as string,
          title: toolInput.title as string | undefined,
          kind: toolInput.kind as string | undefined,
        });
        result = JSON.stringify({ artifact_id: art.id, project_id: toolInput.project_id as string, title: art.title, kind: art.kind, mime_type: art.mime_type, url: art.url });
        if (regTaskId) finishCampaignTask(userId, regTaskId, result);
        break;
      }
      case 'list_artifacts': {
        const artifacts = listProjectArtifacts(toolInput.project_id as string);
        result = JSON.stringify(artifacts.map(a => ({
          id: a.id, kind: a.kind, title: a.title, description: a.description,
          status: a.status, mime_type: a.mime_type, created_at: a.created_at,
        })), null, 2);
        break;
      }
      case 'read_artifact': {
        const art = getArtifactById(toolInput.artifact_id as string);
        if (!art && !(toolInput.artifact_id as string).includes(':')) {
          result = `Error: artifact ${toolInput.artifact_id} not found`;
          break;
        }
        const content = await readArtifactContent(toolInput.project_id as string, toolInput.artifact_id as string);
        if (content === null) {
          result = 'Error: artifact has no readable text content (binary or URL-only artifact)';
          break;
        }
        result = content;
        break;
      }
      case 'list_connections': {
        const conns = getDb()
          .prepare("SELECT id, name, type, purpose FROM connections WHERE user_id = ? ORDER BY created_at")
          .all(userId) as Array<{ id: string; name: string; type: string; purpose: string }>;
        const enriched = await Promise.all(conns.map(async c => {
          if (c.type !== 'mcp') return c;
          try {
            const cfg = getDecryptedConfig(c.id, userId);
            const mcpArgs = cfg.args ? JSON.parse(cfg.args) : [];
            const mcpEnv = cfg.env ? JSON.parse(cfg.env) : {};
            const tools = await listMcpTools(c.id, cfg.command, mcpArgs, mcpEnv);
            return { ...c, mcp_tools: tools.map(t => ({ name: t.name, description: t.description })) };
          } catch {
            return { ...c, mcp_tools: [] };
          }
        }));
        result = JSON.stringify(enriched, null, 2);
        break;
      }
      case 'test_connection': {
        const connRow = getDb()
          .prepare("SELECT id, name, type FROM connections WHERE id = ? AND user_id = ?")
          .get(toolInput.connection_id as string, userId) as { id: string; name: string; type: string } | undefined;
        if (!connRow) { result = `Error: connection ${toolInput.connection_id} not found`; break; }
        if (connRow.type !== 'mcp') {
          const cfg = getDecryptedConfig(connRow.id, userId);
          const hasKey = Object.values(cfg).some(v => v && String(v).length > 0);
          result = JSON.stringify({ id: connRow.id, name: connRow.name, type: connRow.type, status: hasKey ? 'ok' : 'error', error: hasKey ? null : 'No credentials configured' });
          break;
        }
        try {
          const cfg = getDecryptedConfig(connRow.id, userId);
          const mcpArgs = cfg.args ? JSON.parse(cfg.args) : [];
          const mcpEnv = cfg.env ? JSON.parse(cfg.env) : {};
          const tools = await listMcpTools(connRow.id, cfg.command, mcpArgs, mcpEnv);
          result = JSON.stringify({ id: connRow.id, name: connRow.name, type: 'mcp', status: 'ok', tools: tools.map(t => ({ name: t.name, description: t.description })) });
        } catch (err) {
          result = JSON.stringify({ id: connRow.id, name: connRow.name, type: 'mcp', status: 'error', error: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
      case 'read_file':
        result = await readFile({ project_id: projectId, path: toolInput.path as string, offset: toolInput.offset as number | undefined, limit: toolInput.limit as number | undefined }, { userId, executionId, projectId, sessionId });
        break;
      case 'list_dir':
        result = await listDir({ project_id: projectId, path: toolInput.path as string | undefined }, { userId, executionId, projectId, sessionId });
        break;
      case 'search_files':
        result = await searchFiles({
          project_id: projectId,
          pattern: toolInput.pattern as string,
          path: toolInput.path as string | undefined,
          file_glob: toolInput.file_glob as string | undefined,
          ignore_case: toolInput.ignore_case as boolean | undefined,
        }, { userId, executionId, projectId, sessionId });
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
        result = JSON.stringify({ artifact_id: artifact.id, project_id: projectId, title: artifact.title, kind: artifact.kind, mime_type: artifact.mime_type });
        const event = createSessionEvent({
          sessionId,
          type: 'artifact_created',
          title: `Created artifact: ${artifact.title}`,
          body: artifact.kind,
          projectId,
          artifactId: artifact.id,
          executionId,
          metadata: { kind: artifact.kind, mime_type: artifact.mime_type },
        });
        broadcast(userId, { type: 'session_event_created', sessionId, event: { ...event, metadata: JSON.parse(event.metadata || '{}') } });
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
        if (!result.startsWith('Error:')) {
          const createdProject = getDb()
            .prepare('SELECT id, name FROM projects WHERE user_id = ? AND name = ?')
            .get(userId, toolInput.name as string) as { id: string; name: string } | undefined;
          if (createdProject) {
            linkSessionProject(sessionId, createdProject.id, 'agent');
            const event = createSessionEvent({
              sessionId,
              type: 'project_created',
              title: `Created project: ${createdProject.name}`,
              body: 'Created from this chat.',
              projectId: createdProject.id,
              executionId,
              metadata: { source: 'agent' },
            });
            broadcast(userId, { type: 'session_event_created', sessionId, event: { ...event, metadata: JSON.parse(event.metadata || '{}') } });
          }
        }
        break;
      case 'update_project':
        result = await updateProject(
          {
            project_id: toolInput.project_id as string,
            name: toolInput.name as string | undefined,
            description: toolInput.description as string | undefined,
            repo_path: toolInput.repo_path as string | null | undefined,
          },
          userId
        );
        break;
      case 'delete_project':
        result = await deleteProject({ project_id: toolInput.project_id as string, delete_files: toolInput.delete_files as boolean }, userId, executionId);
        break;
      case 'list_campaigns': {
        const summaries = getCampaignSummaries(toolInput.project_id as string);
        result = JSON.stringify(summaries.map(c => ({
          id: c.id,
          title: c.title,
          status: c.status,
          total_tasks: c.total_tasks,
          done_tasks: c.done_tasks,
          error_tasks: c.error_tasks,
          created_at: c.created_at,
          completed_at: c.completed_at,
        })), null, 2);
        break;
      }
      case 'get_campaign': {
        const campaign = getCampaignById(toolInput.campaign_id as string);
        if (!campaign) { result = `Error: campaign ${toolInput.campaign_id} not found`; break; }
        const tasks = getCampaignTasks(campaign.id);
        result = JSON.stringify({
          id: campaign.id,
          title: campaign.title,
          status: campaign.status,
          created_at: campaign.created_at,
          completed_at: campaign.completed_at,
          tasks: tasks.map(t => ({
            id: t.id,
            title: t.title,
            agent: t.agent,
            status: t.status,
            execution_id: t.execution_id,
            result: null as string | null,
          })),
        }, null, 2);
        // attach result strings from executions (truncated — use get_execution_output for full log)
        const SUMMARY_CAP = 500;
        const parsed = JSON.parse(result) as { tasks: Array<{ execution_id: string | null; result: string | null }> };
        for (const t of parsed.tasks) {
          if (t.execution_id) {
            const ex = getExecutionById(t.execution_id);
            const r = ex?.result ?? null;
            t.result = r && r.length > SUMMARY_CAP ? r.slice(0, SUMMARY_CAP) + '…(use get_execution_output for full output)' : r;
          }
        }
        result = JSON.stringify(parsed, null, 2);
        break;
      }
      case 'get_execution_output': {
        const ex = getExecutionById(toolInput.execution_id as string);
        if (!ex) { result = `Error: execution ${toolInput.execution_id} not found`; break; }
        const LOG_CAP = 8000;
        const log = ex.output_log;
        const truncated = log.length > LOG_CAP;
        const output_log = truncated ? `[truncated — showing last ${LOG_CAP} of ${log.length} chars]\n${log.slice(-LOG_CAP)}` : log;
        result = JSON.stringify({ id: ex.id, tool: ex.tool, status: ex.status, result: ex.result, output_log }, null, 2);
        break;
      }
      case 'resume_campaign': {
        const resumed = resumeCampaign(toolInput.campaign_id as string);
        if (!resumed) { result = `Error: campaign ${toolInput.campaign_id} not found or cannot be resumed (cancelled campaigns cannot be resumed)`; break; }
        result = JSON.stringify({
          id: resumed.campaign.id,
          title: resumed.campaign.title,
          status: resumed.campaign.status,
          tasks: resumed.tasks.map(t => ({ id: t.id, title: t.title, agent: t.agent, status: t.status, execution_id: t.execution_id })),
        }, null, 2);
        break;
      }
      case 'list_scheduled_tasks': {
        const tasks = getScheduledTasksForUser(userId);
        result = JSON.stringify(tasks.map(t => ({
          id: t.id, type: t.type, prompt: t.prompt,
          interval_hours: t.interval_hours, enabled: !!t.enabled,
          next_run_at: t.next_run_at, last_run_at: t.last_run_at,
        })), null, 2);
        break;
      }
      case 'create_scheduled_task': {
        const stType = toolInput.type as string;
        const stPrompt = toolInput.prompt as string | undefined;
        if (stType === 'custom_prompt' && !stPrompt) { result = 'Error: prompt is required for custom_prompt tasks'; break; }
        const stId = createScheduledTask(userId, stType, toolInput.interval_hours as number, stPrompt);
        result = JSON.stringify({ id: stId, type: stType, interval_hours: toolInput.interval_hours, enabled: true });
        break;
      }
      case 'update_scheduled_task': {
        updateScheduledTask(toolInput.task_id as string, userId, {
          enabled: toolInput.enabled as boolean | undefined,
          interval_hours: toolInput.interval_hours as number | undefined,
        });
        result = 'Scheduled task updated';
        break;
      }
      case 'delete_scheduled_task': {
        const decision = await requestApproval(executionId, userId, 'delete_scheduled_task', { task_id: toolInput.task_id }, 'user');
        if (decision === 'rejected') {
          result = 'User rejected delete_scheduled_task';
          break;
        }
        const deleted = deleteScheduledTask(toolInput.task_id as string, userId);
        result = deleted ? 'Scheduled task deleted' : `Error: task ${toolInput.task_id} not found`;
        break;
      }
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
        try {
          const parsed = JSON.parse(result) as { campaign_id?: string; project_id?: string };
          if (parsed.campaign_id && parsed.project_id) {
            const event = createSessionEvent({
              sessionId,
              type: 'campaign_created',
              title: `Created campaign: ${toolInput.title as string}`,
              body: 'Tracks agent work from this chat.',
              projectId: parsed.project_id,
              campaignId: parsed.campaign_id,
              executionId,
              metadata: { source: 'agent' },
            });
            broadcast(userId, { type: 'session_event_created', sessionId, event: { ...event, metadata: JSON.parse(event.metadata || '{}') } });
          }
        } catch { /* ignore malformed tool result */ }
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

  // Fire and forget — warms the model list cache for the UI
  listClaudeModels(userId).catch(() => {});

  const intent = classifyIntent(lastUserMsg);
  const model = session?.model ?? await resolveModelForTurn(client, intent, effort, apiKey);

  const systemPrompt = buildContext(userId, sessionId, intent);
  const tools = toolDefinitions;

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

        const toolResults = await dispatchToolBlocks(toolUseBlocks, userId, userMessageId, sessionId);

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
