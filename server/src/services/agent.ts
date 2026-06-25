import Anthropic from '@anthropic-ai/sdk';
import { exec as execCallback } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { createSessionEvent, getDb, getSpaceForUser, linkSessionProject, setAgentWorktreeSession, updatePlanStepStatus, maybeCompletePlan, getPlanForStep, getPlanSummaries, getPlanById, getPlanSteps, getExecutionById, getScheduledTasksForUser, createScheduledTask, updateScheduledTask, deleteScheduledTask, resumePlan, getPermissionProfile, createPipeline, getPipelineById, getPipelineTasks, listPipelinesForUser, createPlan, recordAgentUsage, addSessionDiscoveredTools, getSessionDiscoveredTools, upsertMcpRegistryTools, setSessionProviderInfo, type DbPlan, type DbPlanStep, type AgentUsageTool } from '../db/index.js';
import { getItemsForSpace, getItemById, createNoteItem, createFileItem, createRepoItem, readItemContent, registerFileItem, type SpaceItem, type Block } from './items.js';
import {
  runCreateItem,
  runUpdateItem,
  runReadItem,
  runListItemTemplates,
  runCreateItemTemplate,
  runUpdateItemTemplate,
} from '../tools/item_ops.js';

const execAsync = promisify(execCallback);
import { runAgentPipeline, type AgentPipelineCtx } from './agent_pipeline.js';
import { ensureWorktree } from '../lib/worktree.js';
import { getDecryptedConfig } from '../routes/connections.js';
import { createExecution, completeExecution, appendOutput, requestApproval } from './executor.js';
import { runGitOp } from '../tools/git_op.js';
import { invokeClaudeCode } from '../tools/invoke_claude_code.js';
import { invokeCodex } from '../tools/invoke_codex.js';
import { callMcpTool } from '../tools/mcp_call.js';
import { runProjectQuery } from '../tools/project_query.js';
import { buildGraph } from './graphify.js';
import { remember, recall, forget } from '../tools/memory_tools.js';
import { readFile, listDir, writeFile, searchFiles } from '../tools/file_ops.js';
import { runCommand, isBlocked } from '../tools/run_command.js';
import { readChat } from '../tools/read_chat.js';
import { listProjects, createProject, updateProject, deleteProject } from '../tools/project_ops.js';
import { createConnectionTool } from '../tools/connection_ops.js';
import { runCreatePlan } from '../tools/create_plan.js';
import { broadcast } from './socket.js';
import { newId } from '../lib/ids.js';
import { DEFAULT_EFFORT, getAnthropicKey, resolveModelForTurn, listClaudeModels, tokensToUsd, withTransientRetry, isTransientApiError, type EffortLevel } from './anthropic.js';
import { getLeadAgentProvider } from './lead_agent_providers.js';
import { classifyIntent } from './intent.js';
import { buildContext } from './context.js';
import { toolDefinitions } from '../tools/definitions.js';
import { searchTools } from './toolSearch.js';
import { resolveRegistryTool, dispatchRegistryTool, ingestMcpTools } from './toolRegistry.js';
import { extractAndRemember } from './extract-memory.js';
import { renderVideo, type VideoScene } from './video.js';
import { listMcpTools } from '../lib/mcp-pool.js';
import { maybeDistill } from './distill.js';
import { generateMcpToken } from '../mcp/auth.js';
import { getConversationProvider } from './conversation-provider.js';

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

function buildPlanPriorContext(planStepId: string): string | null {
  const plan = getPlanForStep(planStepId);
  if (!plan) return null;

  const currentStep = getDb()
    .prepare('SELECT position FROM plan_steps WHERE id = ?')
    .get(planStepId) as { position: number } | undefined;
  if (!currentStep) return null;

  const priorSteps = getDb()
    .prepare(`
      SELECT ps.title, ps.execution_id
      FROM plan_steps ps
      WHERE ps.plan_id = ? AND ps.position < ? AND ps.status = 'done'
      ORDER BY ps.position
    `)
    .all(plan.id, currentStep.position) as Array<{ title: string; execution_id: string | null }>;

  if (priorSteps.length === 0) return null;

  const MAX_RESULT_CHARS = 4000;
  const parts = priorSteps.map(t => {
    if (!t.execution_id) return `### ${t.title}\n(no output recorded)`;
    const ex = getExecutionById(t.execution_id);
    if (!ex?.result) return `### ${t.title}\n(no output recorded)`;
    const result = ex.result.length > MAX_RESULT_CHARS
      ? ex.result.slice(0, MAX_RESULT_CHARS) + '\n…(truncated)'
      : ex.result;
    return `### ${t.title}\n${result}`;
  });

  return `## Prior plan step results\nPlan: "${plan.title}"\n\n${parts.join('\n\n')}`;
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

interface DbMessage { id: string; role: string; content: string; }
interface DbMessageAttachment {
  messageId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}


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

function startPlanStep(userId: string, stepId: string, executionId: string): void {
  updatePlanStepStatus(stepId, 'running', executionId);
  broadcast(userId, { type: 'plan_step_updated', stepId, status: 'running' });
}

function finishPlanStep(userId: string, stepId: string, result: string): void {
  const status = result.startsWith('Error') ? 'error' : 'done';
  updatePlanStepStatus(stepId, status);
  const stepRow = getDb()
    .prepare('SELECT plan_id FROM plan_steps WHERE id = ?')
    .get(stepId) as { plan_id: string } | undefined;
  if (stepRow) maybeCompletePlan(stepRow.plan_id);
  broadcast(userId, { type: 'plan_step_updated', stepId, status });
}

const PARALLEL_SAFE_TOOLS = new Set([
  'recall',
  'list_chats',
  'read_chat',
  'list_items',
  'read_item',
  'list_item_templates',
  'list_spaces',
  'list_connections',
  'test_connection',
  'search_files',
  'read_file',
  'list_dir',
  'project_query',
  'list_plans',
  'get_plan',
  'get_execution_output',
  'list_scheduled_tasks',
  'wait_for_execution',
  'tool_search',
]);

const CORE_TOOLS = new Set([
  // Discovery + memory
  'tool_search', 'recall', 'remember', 'forget',
  // File access
  'read_file', 'search_files', 'list_dir', 'write_file', 'register_file_item',
  // Coding agents — always available; the auto-approved list references these on turn 1
  'invoke_claude_code', 'invoke_codex', 'get_execution_output',
  // Post-coding mandatory flow
  'git_op', 'run_command',
  // State-awareness checks (system prompt requires these before starting work)
  'list_plans', 'get_plan', 'list_items', 'run_plan', 'resume_plan',
  // Codebase understanding
  'project_query', 'rebuild_graph',
  // Connection management
  'list_connections', 'create_connection', 'test_connection',
  // Orchestration
  'create_plan', 'delegate_to_agent', 'run_pipeline',
  // Chat history
  'list_chats', 'read_chat',
  // Media generation
  'generate_video',
  // Scheduled tasks
  'list_scheduled_tasks', 'create_scheduled_task', 'update_scheduled_task',
  // Item management
  'create_item', 'update_item', 'read_item', 'create_note',
  'list_item_templates', 'create_item_template', 'update_item_template',
  // Space management — list before create, never guess a space_id. delete_space
  // stays discovery-only (tool_search) like other destructive delete_* tools —
  // it's user-approved and rare enough not to need default-turn availability.
  'list_spaces', 'create_space', 'update_space',
]);

export function resolveToolsForTurn(userId: string, sessionId: string): Anthropic.Tool[] {
  const core = toolDefinitions.filter(t => CORE_TOOLS.has(t.name));
  const discoveredNames = getSessionDiscoveredTools(sessionId);
  const discovered = discoveredNames
    .filter(name => !CORE_TOOLS.has(name))
    .map(name => toolDefinitions.find(t => t.name === name) ?? resolveRegistryTool(userId, name))
    .filter((t): t is Anthropic.Tool => Boolean(t));
  return [...core, ...discovered];
}

// Best-effort session-event emission: writing a session event + broadcasting it
// is telemetry, not core execution. It must never abort or mask the tool call
// that triggered it, so swallow and log any failure here.
function emitSessionEvent(userId: string, input: Parameters<typeof createSessionEvent>[0]): void {
  try {
    const event = createSessionEvent(input);
    broadcast(userId, {
      type: 'session_event_created',
      sessionId: input.sessionId,
      event: { ...event, metadata: JSON.parse(event.metadata || '{}') },
    });
  } catch (err) {
    console.error('emitSessionEvent failed (non-fatal):', err);
  }
}

function noteProjectUse(userId: string, sessionId: string, space: { id: string; name: string }, executionId?: string): void {
  let linked = false;
  try {
    linked = linkSessionProject(sessionId, space.id, 'agent');
  } catch (err) {
    console.error('noteProjectUse: linkSessionProject failed (non-fatal):', err);
    return;
  }
  if (!linked) return;
  emitSessionEvent(userId, {
    sessionId,
    type: 'project_linked',
    title: `Scoped to ${space.name}`,
    body: 'The agent attached this chat to a space automatically.',
    spaceId: space.id,
    executionId: executionId ?? null,
    metadata: { source: 'agent' },
  });
}

function isTextLikeAttachment(attachment: DbMessageAttachment): boolean {
  if (attachment.mimeType.startsWith('text/')) return true;
  return /\.(csv|json|md|txt|log|tsx?|jsx?|css|html?|xml|yaml|yml|toml|sql|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|sh|zsh|env)$/i
    .test(attachment.filename);
}

function buildMessageContent(content: string, attachments: DbMessageAttachment[]): string | Anthropic.ContentBlockParam[] {
  if (attachments.length === 0) return content;

  const blocks: Anthropic.ContentBlockParam[] = [];
  const intro = content.trim();
  if (intro) blocks.push({ type: 'text', text: intro });

  const skipped: string[] = [];
  for (const attachment of attachments) {
    if (!fs.existsSync(attachment.storagePath)) {
      skipped.push(`${attachment.filename} (missing from storage)`);
      continue;
    }

    if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(attachment.mimeType)) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: fs.readFileSync(attachment.storagePath).toString('base64'),
        },
      });
      continue;
    }

    if (attachment.mimeType === 'application/pdf') {
      blocks.push({
        type: 'document',
        title: attachment.filename,
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: fs.readFileSync(attachment.storagePath).toString('base64'),
        },
      });
      continue;
    }

    if (isTextLikeAttachment(attachment)) {
      const MAX_TEXT_ATTACHMENT_CHARS = 30_000;
      const text = fs.readFileSync(attachment.storagePath, 'utf8');
      const truncated = text.length > MAX_TEXT_ATTACHMENT_CHARS
        ? `${text.slice(0, MAX_TEXT_ATTACHMENT_CHARS)}\n\n[Attachment truncated after ${MAX_TEXT_ATTACHMENT_CHARS} characters.]`
        : text;
      blocks.push({
        type: 'text',
        text: `\n\n[Attached file: ${attachment.filename} (${attachment.mimeType || 'text/plain'}, ${attachment.sizeBytes} bytes)]\n${truncated}`,
      });
      continue;
    }

    skipped.push(`${attachment.filename} (${attachment.mimeType || 'unknown type'}, ${attachment.sizeBytes} bytes)`);
  }

  if (skipped.length) {
    blocks.push({
      type: 'text',
      text: `\n\n[Unsupported attachments were provided but not sent to the model: ${skipped.join(', ')}]`,
    });
  }

  return blocks.length ? blocks : content;
}

async function runSubAgent(
  instructions: string,
  projectId: string | null,
  userId: string,
  parentExecutionId: string,
  parentMessageId: string,
  parentSessionId: string,
  planId?: string | null,
  maxTurns = 15,
): Promise<string> {
  let apiKey: string;
  try { apiKey = getAnthropicKey(userId); }
  catch { throw new Error('No Anthropic API key configured for sub-agent'); }

  const client = new Anthropic({ apiKey });

  const SUB_TOOLS = new Set(['read_file', 'list_dir', 'search_files', 'project_query', 'recall', 'remember', 'write_file', 'create_note', 'git_op', 'list_items', 'read_item']);
  const subtools = toolDefinitions.filter(t => 'name' in t && SUB_TOOLS.has(t.name as string));

  const systemPrompt = `You are a focused sub-agent completing a specific task.${projectId ? ` Use space_id "${projectId}" when calling Space tools.` : ''} Complete the task fully, then respond with a clear summary of what you accomplished.`;

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: instructions }];
  const parentSession = getDb()
    .prepare('SELECT effort FROM sessions WHERE id = ?')
    .get(parentSessionId) as { effort: EffortLevel } | undefined;
  const effort = parentSession?.effort ?? DEFAULT_EFFORT;
  const SUB_MODEL = await resolveModelForTurn(client, { model: 'sonnet' }, effort, apiKey);
  const clampedMaxTurns = Math.max(1, Math.min(50, maxTurns));
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  emitSessionEvent(userId, {
    sessionId: parentSessionId,
    type: 'subagent_started',
    title: 'Sub-agent started',
    body: instructions.slice(0, 120),
    executionId: parentExecutionId,
    metadata: { projectId: projectId ?? undefined },
  });

  for (let turn = 0; turn < clampedMaxTurns; turn++) {
    if (planId && getPlanById(planId)?.status === 'cancelled') {
      recordAgentUsage(userId, 'subagent', tokensToUsd(SUB_MODEL, totalInputTokens, totalOutputTokens));
      return 'Sub-agent cancelled.';
    }

    const response = await withTransientRetry(() => client.messages.create({
      model: SUB_MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      tools: subtools as Anthropic.Tool[],
      messages,
    }));

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    messages.push({ role: 'assistant', content: response.content });
    appendOutput(parentExecutionId, userId, `[sub-agent turn ${turn + 1}]\n`);

    if (response.stop_reason === 'end_turn') {
      const summary = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('');
      recordAgentUsage(userId, 'subagent', tokensToUsd(SUB_MODEL, totalInputTokens, totalOutputTokens));
      emitSessionEvent(userId, {
        sessionId: parentSessionId,
        type: 'subagent_completed',
        title: 'Sub-agent completed',
        body: summary.slice(0, 120),
        executionId: parentExecutionId,
        metadata: { projectId: projectId ?? undefined, turns: turn + 1 },
      });
      return summary;
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const toolResults = await dispatchToolBlocks(toolUseBlocks, userId, parentMessageId, parentSessionId);
      messages.push({ role: 'user', content: toolResults });
    }
  }

  recordAgentUsage(userId, 'subagent', tokensToUsd(SUB_MODEL, totalInputTokens, totalOutputTokens));
  return `Sub-agent reached max turns limit (${clampedMaxTurns}) without producing a final response.`;
}

async function executePlanStep(
  step: DbPlanStep,
  plan: DbPlan,
  userId: string,
  messageId: string,
  sessionId: string,
): Promise<void> {
  const space = getSpaceForUser(plan.space_id, userId);
  if (!space) throw new Error(`Space ${plan.space_id} not found`);

  const executionId = createExecution(userId, messageId, space.id, step.agent);
  startPlanStep(userId, step.id, executionId);

  const toolArgs: Record<string, unknown> = step.tool_args ? JSON.parse(step.tool_args) : {};
  const prompt = step.prompt ?? '';
  if ((step.agent === 'claude_code' || step.agent === 'codex') && !prompt.trim()) {
    throw new Error(`Plan step "${step.title}" has no prompt. claude_code and codex steps require a detailed brief describing what to build and what done looks like.`);
  }
  const priorCtx = buildPlanPriorContext(step.id);
  const fullPrompt = priorCtx ? `${prompt}\n\n${priorCtx}` : prompt;

  function getRepoItem(): SpaceItem & { type: 'repo' } {
    const itemId = toolArgs.item_id as string | undefined;
    if (!itemId) throw new Error(`Plan step "${step.title}" requires tool_args.item_id`);
    const repoItem = getItemById(itemId);
    if (!repoItem || repoItem.space_id !== space!.id) throw new Error(`Repo item ${itemId} not found in Space '${space!.name}'`);
    if (repoItem.type !== 'repo') throw new Error(`Item ${itemId} is not a repo`);
    return repoItem;
  }

  try {
    let result: string;

    switch (step.agent) {
      case 'claude_code': {
        const repoItem = getRepoItem();
        let apiKey: string | null = null;
        try { apiKey = getAnthropicKey(userId); } catch { /* use CLI auth */ }
        const worktree = await ensureWorktree(repoItem, sessionId);
        let graphKey: string | null = null;
        try { graphKey = getAnthropicKey(userId); } catch {}
        const ctx: AgentPipelineCtx = { userId, tool: 'claude_code', repoPath: repoItem.repo_path, projectId: space.id, graphKey };
        await runAgentPipeline(ctx, async () => {
          const r = await invokeClaudeCode(
            { prompt: fullPrompt, model: toolArgs.model as string | undefined },
            { userId, executionId, repoPath: worktree.worktree_path, apiKey, resumeSessionId: worktree.claude_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId), onSessionId: (id) => setAgentWorktreeSession(worktree.id, 'claude', id) },
          );
          ctx.result = r.result;
          ctx.costUsd = r.costUsd;
        });
        result = ctx.result!;
        break;
      }
      case 'codex': {
        const repoItem = getRepoItem();
        const connIds: string[] = JSON.parse(space.enabled_connection_ids ?? '[]');
        let codexKey: string | null = null;
        if (connIds.length > 0) {
          const openaiConn = getDb()
            .prepare(`SELECT id FROM connections WHERE id IN (${connIds.map(() => '?').join(',')}) AND type = 'openai' LIMIT 1`)
            .get(...connIds) as { id: string } | undefined;
          if (openaiConn) {
            codexKey = getDecryptedConfig(openaiConn.id, userId).apiKey;
          }
        }
        const cWorktree = await ensureWorktree(repoItem, sessionId);
        let cGraphKey: string | null = null;
        try { cGraphKey = getAnthropicKey(userId); } catch {}
        const cCtx: AgentPipelineCtx = { userId, tool: 'codex', repoPath: repoItem.repo_path, projectId: space.id, graphKey: cGraphKey };
        await runAgentPipeline(cCtx, async () => {
          const cr = await invokeCodex(
            { prompt: fullPrompt, model: toolArgs.model as string | undefined },
            { userId, executionId, repoPath: cWorktree.worktree_path, apiKey: codexKey, resumeSessionId: cWorktree.codex_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId), onSessionId: (id) => setAgentWorktreeSession(cWorktree.id, 'codex', id) },
          );
          cCtx.result = cr.result;
          cCtx.costUsd = cr.costUsd;
        });
        result = cCtx.result!;
        break;
      }
      case 'eval': {
        const repoItem = getRepoItem();
        const evalBlocked = isBlocked(prompt);
        if (evalBlocked) throw new Error(evalBlocked);
        const evalWorktree = await ensureWorktree(repoItem, sessionId);
        const evalDecision = await requestApproval(executionId, userId, 'eval', { command: prompt, cwd: evalWorktree.worktree_path }, 'agent');
        if (evalDecision === 'rejected') { result = 'eval cancelled'; break; }
        try {
          const { stdout, stderr } = await execAsync(prompt, { cwd: evalWorktree.worktree_path, timeout: 60_000 });
          result = [stdout, stderr].filter(Boolean).join('\n') || 'Command completed successfully';
          appendOutput(executionId, userId, result);
        } catch (err: unknown) {
          const e = err as { code?: number; stdout?: string; stderr?: string; message?: string; killed?: boolean };
          if (e.killed) throw new Error(`eval timed out after 60s`);
          const output = [e.stdout, e.stderr].filter(Boolean).join('\n');
          appendOutput(executionId, userId, output);
          throw new Error(`Exit ${e.code ?? 1}: ${output || e.message}`);
        }
        break;
      }
      case 'subagent': {
        result = await runSubAgent(fullPrompt, plan.space_id, userId, executionId, messageId, sessionId, plan.id);
        break;
      }
      case 'git': {
        const repoItem = getRepoItem();
        const gitWorktree = await ensureWorktree(repoItem, sessionId);
        result = await runGitOp(
          {
            op: (toolArgs.op as 'log' | 'diff' | 'status' | 'commit' | 'push') ?? 'commit',
            message: (toolArgs.message as string | undefined) ?? prompt,
            branch: (toolArgs.branch as string | undefined) ?? gitWorktree.branch,
          },
          { userId, executionId, projectId: space.id, repoPath: gitWorktree.worktree_path },
        );
        break;
      }
      case 'github': {
        result = 'Error: github step type is no longer supported. Configure the GitHub MCP server in Settings → MCP and use agent type "mcp" with the appropriate tool_name instead.';
        break;
      }
      case 'file_write': {
        result = await writeFile(
          { space_id: space.id, item_id: getRepoItem().id, path: toolArgs.path as string, content: (toolArgs.content as string) ?? prompt },
          { userId, executionId, sessionId, permissionProfile: getPermissionProfile(userId) },
        );
        break;
      }
      case 'mcp': {
        const mcpConnId = toolArgs.connection_id as string;
        const mcpConn = getDb()
          .prepare("SELECT id FROM connections WHERE id = ? AND user_id = ? AND type = 'mcp'")
          .get(mcpConnId, userId) as { id: string } | undefined;
        if (!mcpConn) throw new Error(`MCP connection ${mcpConnId} not found`);
        const mcpConfig = getDecryptedConfig(mcpConn.id, userId);
        result = await callMcpTool(
          mcpConnId,
          mcpConfig.command,
          mcpConfig.args ? JSON.parse(mcpConfig.args) : [],
          mcpConfig.env ? JSON.parse(mcpConfig.env) : {},
          toolArgs.tool_name as string,
          toolArgs.tool_input as Record<string, unknown>,
        );
        break;
      }
      default:
        throw new Error(`Unknown step agent type: ${step.agent}`);
    }

    completeExecution(executionId, userId, 'done', result);
    finishPlanStep(userId, step.id, result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    completeExecution(executionId, userId, 'error', msg);
    finishPlanStep(userId, step.id, `Error: ${msg}`);
    throw err;
  }
}

export async function runPlanAutoDispatch(
  planId: string,
  userId: string,
  messageId: string,
  sessionId: string,
  onError: 'stop' | 'continue' = 'stop',
): Promise<{ done: number; error: number; total: number; errors: Array<{ step_id: string; title: string; error: string }> }> {
  const plan = getPlanById(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);

  while (true) {
    const fresh = getPlanById(planId)!;
    if (fresh.status === 'cancelled') break;

    const allSteps = getPlanSteps(planId);
    const doneIds = new Set(allSteps.filter(s => s.status === 'done').map(s => s.id));
    const hasError = allSteps.some(s => s.status === 'error');

    if (hasError && onError === 'stop') break;
    if (allSteps.every(s => s.status === 'done' || s.status === 'error')) break;

    const ready = allSteps.filter(s => {
      if (s.status !== 'waiting') return false;
      const deps: string[] = s.depends_on ? JSON.parse(s.depends_on) : [];
      return deps.every(depId => doneIds.has(depId));
    });

    if (ready.length === 0) {
      const waitingSteps = allSteps.filter(s => s.status === 'waiting');
      if (waitingSteps.length > 0) {
        const db = getDb();
        for (const s of waitingSteps) {
          db.prepare("UPDATE plan_steps SET status = 'error', completed_at = unixepoch() WHERE id = ?").run(s.id);
          broadcast(userId, { type: 'plan_step_updated', stepId: s.id, status: 'error' });
        }
        maybeCompletePlan(planId);
      }
      break;
    }

    const results = await Promise.allSettled(
      ready.map(step => executePlanStep(step, plan, userId, messageId, sessionId))
    );

    if (onError === 'stop' && results.some(r => r.status === 'rejected')) break;
  }

  const finalSteps = getPlanSteps(planId);
  const erroredSteps = finalSteps.filter(s => s.status === 'error');
  const errors = erroredSteps.map(s => {
    const ex = s.execution_id ? getExecutionById(s.execution_id) : null;
    const errorMsg = ex?.result ?? 'Unknown error';
    return {
      step_id: s.id,
      title: s.title,
      error: errorMsg.length > 500 ? errorMsg.slice(0, 500) + '…' : errorMsg,
    };
  });
  return {
    done: finalSteps.filter(s => s.status === 'done').length,
    error: finalSteps.filter(s => s.status === 'error').length,
    total: finalSteps.length,
    errors,
  };
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
  // Accept space_id (new) or project_id (legacy alias still sent by older prompts)
  const spaceId = (toolInput.space_id as string | undefined) ?? (toolInput.project_id as string | undefined) ?? 'unknown';
  const space = getSpaceForUser(spaceId, userId);
  const executionId = createExecution(userId, messageId, space?.id ?? null, toolName);
  if (space) noteProjectUse(userId, sessionId, space, executionId);

  const planStepId = toolInput.plan_step_id as string | undefined;
  if (planStepId) {
    const plan = getPlanForStep(planStepId);
    if (plan?.status === 'cancelled') {
      completeExecution(executionId, userId, 'error', 'Plan cancelled');
      return 'Error: Plan was cancelled';
    }
  }

  try {
    let result: string;

    function getRepoItemForSpace(): SpaceItem & { type: 'repo' } | null {
      if (!space) return null;
      const itemId = toolInput.item_id as string | undefined;
      if (!itemId) return null;
      const item = getItemById(itemId);
      return item?.space_id === space.id && item.type === 'repo' ? item : null;
    }

    switch (toolName) {
      case 'invoke_claude_code': {
        if (!space) {
          result = `Error: space ${spaceId} not found`;
          break;
        }
        const ccRepoItem = getRepoItemForSpace();
        if (!ccRepoItem) {
          result = `Repo item ${toolInput.item_id ?? '(missing)'} not found in Space '${space.name}'.`;
          break;
        }
        const connectionIds: string[] = JSON.parse(space.enabled_connection_ids ?? '[]');
        let ccApiKey: string | null = null;
        try { ccApiKey = getAnthropicKey(userId); } catch { /* use CLI's local auth */ }
        if (connectionIds.length > 0) {
          const anthropicConn = getDb()
            .prepare(`SELECT id FROM connections WHERE id IN (${connectionIds.map(() => '?').join(',')}) AND type = 'anthropic' LIMIT 1`)
            .get(...connectionIds) as { id: string } | undefined;
          if (anthropicConn) ccApiKey = getDecryptedConfig(anthropicConn.id, userId).apiKey;
        }
        const ccWorktree = await ensureWorktree(ccRepoItem, sessionId);
        const ccStepId = toolInput.plan_step_id as string | undefined;
        if (ccStepId) startPlanStep(userId, ccStepId, executionId);
        let ccGraphKey: string | null = null;
        try { ccGraphKey = getAnthropicKey(userId); } catch { /* none configured */ }
        const ccCtx: AgentPipelineCtx = { userId, tool: 'claude_code', repoPath: ccRepoItem.repo_path, projectId: space.id, graphKey: ccGraphKey };
        const ccPrior = ccStepId ? buildPlanPriorContext(ccStepId) : null;
        const ccPrompt = ccPrior ? `${toolInput.prompt as string}\n\n${ccPrior}` : toolInput.prompt as string;
        await runAgentPipeline(ccCtx, async () => {
          const ccResult = await invokeClaudeCode(
            { prompt: ccPrompt, model: toolInput.model as string | undefined },
            { userId, executionId, repoPath: ccWorktree.worktree_path, apiKey: ccApiKey, resumeSessionId: ccWorktree.claude_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId), onSessionId: (id) => setAgentWorktreeSession(ccWorktree.id, 'claude', id) }
          );
          ccCtx.result = ccResult.result;
          ccCtx.costUsd = ccResult.costUsd;
        });
        result = ccCtx.result!;
        if (ccStepId) finishPlanStep(userId, ccStepId, result);
        break;
      }
      case 'invoke_codex': {
        if (!space) {
          result = `Error: space ${spaceId} not found`;
          break;
        }
        const codexRepoItem = getRepoItemForSpace();
        if (!codexRepoItem) {
          result = `Repo item ${toolInput.item_id ?? '(missing)'} not found in Space '${space.name}'.`;
          break;
        }
        const connectionIds: string[] = JSON.parse(space.enabled_connection_ids ?? '[]');
        let codexApiKey: string | null = null;
        if (connectionIds.length > 0) {
          const openaiConn = getDb()
            .prepare(`SELECT id FROM connections WHERE id IN (${connectionIds.map(() => '?').join(',')}) AND type = 'openai' LIMIT 1`)
            .get(...connectionIds) as { id: string } | undefined;
          if (openaiConn) codexApiKey = getDecryptedConfig(openaiConn.id, userId).apiKey;
        }
        const codexWorktree = await ensureWorktree(codexRepoItem, sessionId);
        const codexStepId = toolInput.plan_step_id as string | undefined;
        if (codexStepId) startPlanStep(userId, codexStepId, executionId);
        let codexGraphKey: string | null = null;
        try { codexGraphKey = getAnthropicKey(userId); } catch { /* none configured */ }
        const codexCtx: AgentPipelineCtx = { userId, tool: 'codex', repoPath: codexRepoItem.repo_path, projectId: space.id, graphKey: codexGraphKey };
        const codexPrior = codexStepId ? buildPlanPriorContext(codexStepId) : null;
        const codexPrompt = codexPrior ? `${toolInput.prompt as string}\n\n${codexPrior}` : toolInput.prompt as string;
        await runAgentPipeline(codexCtx, async () => {
          const codexResult = await invokeCodex(
            { prompt: codexPrompt, model: toolInput.model as string | undefined },
            { userId, executionId, repoPath: codexWorktree.worktree_path, apiKey: codexApiKey, resumeSessionId: codexWorktree.codex_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId), onSessionId: (id) => setAgentWorktreeSession(codexWorktree.id, 'codex', id) }
          );
          codexCtx.result = codexResult.result;
          codexCtx.costUsd = codexResult.costUsd;
        });
        result = codexCtx.result!;
        if (codexStepId) finishPlanStep(userId, codexStepId, result);
        break;
      }
      case 'tool_search': {
        const matches = searchTools(userId, toolInput.query as string);
        if (matches.length === 0) {
          result = 'No matching tools found, try rephrasing the query.';
          break;
        }
        addSessionDiscoveredTools(sessionId, matches.map(m => m.name));
        result = JSON.stringify(matches, null, 2);
        break;
      }
      case 'git_op': {
        if (!space) {
          result = `Error: space ${spaceId} not found`;
          break;
        }
        const gitRepoItem = getRepoItemForSpace();
        if (!gitRepoItem) {
          result = `Repo item ${toolInput.item_id ?? '(missing)'} not found in Space '${space.name}'.`;
          break;
        }
        const gitWorktree = await ensureWorktree(gitRepoItem, sessionId);
        const gitStepId = toolInput.plan_step_id as string | undefined;
        if (gitStepId) startPlanStep(userId, gitStepId, executionId);
        result = await runGitOp(
          { op: toolInput.op as 'log' | 'diff' | 'status' | 'commit' | 'push', message: toolInput.message as string | undefined, branch: toolInput.branch as string | undefined ?? gitWorktree.branch },
          { userId, executionId, projectId: spaceId, repoPath: gitWorktree.worktree_path }
        );
        if (gitStepId) finishPlanStep(userId, gitStepId, result);
        break;
      }
      case 'project_query': {
        let pqKey: string | null = null;
        try { pqKey = getAnthropicKey(userId); } catch { /* none configured */ }
        result = await runProjectQuery({ space_id: spaceId, item_id: toolInput.item_id as string, question: toolInput.question as string }, userId, pqKey);
        break;
      }
      case 'rebuild_graph': {
        const rgRepoItem = getRepoItemForSpace();
        if (!rgRepoItem) {
          result = space ? `Space '${space.name}' has no repo.` : `Space ${spaceId} not found.`;
          break;
        }
        let rgKey: string | null = null;
        try { rgKey = getAnthropicKey(userId); } catch { /* none configured */ }
        await buildGraph(rgRepoItem.repo_path, rgRepoItem.id, rgKey);
        result = 'Knowledge graph rebuilt successfully.';
        break;
      }
      case 'remember':
        result = remember(
          userId,
          toolInput.type as string,
          toolInput.key as string,
          toolInput.value as string,
          toolInput.space_id as string | undefined ?? toolInput.project_id as string | undefined
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
        const filterSpace = (toolInput.space_id as string | undefined) ?? (toolInput.project_id as string | undefined);
        const rows = filterSpace
          ? getDb().prepare('SELECT id, title, updated_at, pinned_space_id FROM sessions WHERE user_id = ? AND pinned_space_id = ? ORDER BY updated_at DESC LIMIT ?').all(userId, filterSpace, limit)
          : getDb().prepare('SELECT id, title, updated_at, pinned_space_id FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?').all(userId, limit);
        result = JSON.stringify(rows, null, 2);
        break;
      }
      case 'read_chat':
        result = readChat(userId, toolInput.chat_id as string);
        break;
      case 'register_file_item': {
        const regStepId = toolInput.plan_step_id as string | undefined;
        if (regStepId) startPlanStep(userId, regStepId, executionId);
        const itemSpaceId = toolInput.space_id as string;
        if (!getSpaceForUser(itemSpaceId, userId)) { result = `Error: space ${itemSpaceId} not found`; break; }
        const item = await registerFileItem({
          space_id: itemSpaceId,
          source_path: toolInput.file_path as string,
          name: (toolInput.name as string | undefined) ?? path.basename(toolInput.file_path as string),
          source_session_id: sessionId,
          source_plan_id: regStepId ? getPlanForStep(regStepId)?.id ?? null : null,
          source_step_id: regStepId ?? null,
        });
        result = JSON.stringify(item);
        if (regStepId) finishPlanStep(userId, regStepId, result);
        break;
      }
      case 'list_items': {
        const itemSpaceId = toolInput.space_id as string;
        if (!getSpaceForUser(itemSpaceId, userId)) { result = `Error: space ${itemSpaceId} not found`; break; }
        result = JSON.stringify(getItemsForSpace(itemSpaceId), null, 2);
        break;
      }
      case 'read_item': {
        result = await runReadItem(
          {
            space_id: toolInput.space_id as string,
            item_id: toolInput.item_id as string,
          },
          userId,
        );
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
            upsertMcpRegistryTools(userId, c.id, tools.map(t => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema })));
            return { ...c, mcp_tools: tools.map(t => ({ name: t.name, description: t.description })) };
          } catch {
            return { ...c, mcp_tools: [] };
          }
        }));
        result = JSON.stringify(enriched, null, 2);
        if (enriched.filter(c => c.type === 'mcp').length === 0) {
          const alreadyNotified = getDb()
            .prepare("SELECT id FROM session_events WHERE session_id = ? AND type = 'mcp_required'")
            .get(sessionId) as { id: string } | undefined;
          if (!alreadyNotified) {
            emitSessionEvent(userId, {
              sessionId,
              type: 'mcp_required',
              title: 'No MCP servers configured',
              body: 'Add an MCP server in Settings → MCP to enable GitHub, web search, and other integrations.',
            });
          }
        }
        break;
      }
      case 'create_connection': {
        result = await createConnectionTool(
          {
            name: toolInput.name as string,
            type: toolInput.type as string,
            purpose: toolInput.purpose as string | undefined,
            config: toolInput.config as Record<string, unknown>,
          },
          { userId, executionId },
        );
        if (!result.startsWith('Error:') && result !== 'create_connection cancelled') {
          const parsed = JSON.parse(result) as { id: string; name: string; type: string; purpose: string };
          emitSessionEvent(userId, {
            sessionId,
            type: 'connection_created',
            title: `Connected: ${parsed.name}`,
            body: `${parsed.purpose} · ${parsed.type}`,
            executionId,
            metadata: { connection_id: parsed.id, type: parsed.type, purpose: parsed.purpose },
          });
        }
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
          await ingestMcpTools(userId, connRow.id);
          result = JSON.stringify({ id: connRow.id, name: connRow.name, type: 'mcp', status: 'ok', tools: tools.map(t => ({ name: t.name, description: t.description })) });
        } catch (err) {
          result = JSON.stringify({ id: connRow.id, name: connRow.name, type: 'mcp', status: 'error', error: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
      case 'read_file':
        result = await readFile({ space_id: spaceId, item_id: toolInput.item_id as string, path: toolInput.path as string, offset: toolInput.offset as number | undefined, limit: toolInput.limit as number | undefined }, { userId, executionId, sessionId });
        break;
      case 'list_dir':
        result = await listDir({ space_id: spaceId, item_id: toolInput.item_id as string, path: toolInput.path as string | undefined }, { userId, executionId, sessionId });
        break;
      case 'search_files':
        result = await searchFiles({
          space_id: spaceId,
          item_id: toolInput.item_id as string,
          pattern: toolInput.pattern as string,
          path: toolInput.path as string | undefined,
          file_glob: toolInput.file_glob as string | undefined,
          ignore_case: toolInput.ignore_case as boolean | undefined,
        }, { userId, executionId, sessionId });
        break;
      case 'run_command': {
        const rcStepId = toolInput.plan_step_id as string | undefined;
        if (rcStepId) startPlanStep(userId, rcStepId, executionId);
        result = await runCommand(
          {
            command: toolInput.command as string,
            space_id: toolInput.space_id as string | undefined,
            item_id: toolInput.item_id as string | undefined,
            timeout_ms: toolInput.timeout_ms as number | undefined,
          },
          { userId, executionId, permissionProfile: getPermissionProfile(userId) },
        );
        if (rcStepId) finishPlanStep(userId, rcStepId, result);
        break;
      }
      case 'write_file': {
        const writeStepId = toolInput.plan_step_id as string | undefined;
        if (writeStepId) startPlanStep(userId, writeStepId, executionId);
        result = await writeFile(
          { space_id: spaceId, item_id: toolInput.item_id as string, path: toolInput.path as string, content: toolInput.content as string },
          { userId, executionId, sessionId, permissionProfile: getPermissionProfile(userId) }
        );
        if (writeStepId) finishPlanStep(userId, writeStepId, result);
        break;
      }
      case 'create_note': {
        const itemStepId = toolInput.plan_step_id as string | undefined;
        if (itemStepId) startPlanStep(userId, itemStepId, executionId);
        const itemSpaceId = toolInput.space_id as string;
        if (!getSpaceForUser(itemSpaceId, userId)) { result = `Error: space ${itemSpaceId} not found`; break; }
        const item = createNoteItem({
          space_id: itemSpaceId,
          name: toolInput.name as string,
          content: toolInput.content as string,
          source_session_id: sessionId,
          source_plan_id: itemStepId ? getPlanForStep(itemStepId)?.id ?? null : null,
          source_step_id: itemStepId ?? null,
        });
        result = JSON.stringify(item);
        emitSessionEvent(userId, {
          sessionId,
          type: 'item_created',
          title: `Created note: ${item.name}`,
          body: 'note',
          spaceId: itemSpaceId,
          itemId: item.id,
          executionId,
          metadata: { type: 'note' },
        });
        if (itemStepId) finishPlanStep(userId, itemStepId, result);
        break;
      }
      case 'list_spaces':
        result = await listProjects(userId);
        break;
      case 'create_space':
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
          const createdSpace = getDb()
            .prepare('SELECT id, name FROM spaces WHERE user_id = ? AND name = ?')
            .get(userId, toolInput.name as string) as { id: string; name: string } | undefined;
          if (createdSpace) {
            try { linkSessionProject(sessionId, createdSpace.id, 'agent'); }
            catch (err) { console.error('create_space: linkSessionProject failed (non-fatal):', err); }
            emitSessionEvent(userId, {
              sessionId,
              type: 'project_created',
              title: `Created space: ${createdSpace.name}`,
              body: 'Created from this chat.',
              spaceId: createdSpace.id,
              executionId,
              metadata: { source: 'agent' },
            });
          }
        }
        break;
      case 'create_item': {
        const createItemStepId = toolInput.plan_step_id as string | undefined;
        if (createItemStepId) startPlanStep(userId, createItemStepId, executionId);
        result = await runCreateItem(
          {
            space_id: toolInput.space_id as string,
            name: toolInput.name as string,
            type: toolInput.type as string,
            template_id: toolInput.template_id as string | undefined,
            repo_path: toolInput.repo_path as string | undefined,
            default_branch: toolInput.default_branch as string | undefined,
            content: toolInput.content as string | undefined,
            source_session_id: sessionId,
            source_plan_id: createItemStepId ? getPlanForStep(createItemStepId)?.id ?? null : null,
            source_step_id: createItemStepId ?? null,
          },
          userId,
        );
        if (!result.startsWith('Error:')) {
          try {
            const created = JSON.parse(result) as { id?: string; space_id?: string; name?: string; type?: string };
            if (created.id && created.space_id) {
              emitSessionEvent(userId, {
                sessionId,
                type: 'item_created',
                title: `Created item: ${created.name ?? created.id}`,
                body: created.type ?? null,
                spaceId: created.space_id,
                itemId: created.id,
                executionId,
                metadata: { source: 'agent', itemType: created.type },
              });
            }
          } catch { /* non-fatal */ }
        }
        if (createItemStepId) finishPlanStep(userId, createItemStepId, result);
        break;
      }
      case 'update_item': {
        result = await runUpdateItem(
          {
            space_id: toolInput.space_id as string,
            item_id: toolInput.item_id as string,
            blocks: toolInput.blocks as Block[] | undefined,
            block_id: toolInput.block_id as string | undefined,
            block: toolInput.block as Block | undefined,
            overview_blocks: toolInput.overview_blocks as Block[] | null | undefined,
            content: toolInput.content as string | undefined,
          },
          userId,
        );
        if (!result.startsWith('Error:')) {
          try {
            const updated = JSON.parse(result) as { id?: string; space_id?: string; name?: string };
            if (updated.id && updated.space_id) {
              emitSessionEvent(userId, {
                sessionId,
                type: 'item_updated',
                title: `Updated item: ${updated.name ?? updated.id}`,
                body: null,
                spaceId: updated.space_id,
                itemId: updated.id,
                executionId,
                metadata: { source: 'agent' },
              });
            }
          } catch { /* non-fatal */ }
        }
        break;
      }
      case 'list_item_templates': {
        result = await runListItemTemplates(userId);
        break;
      }
      case 'create_item_template': {
        result = await runCreateItemTemplate(
          { name: toolInput.name as string, blocks: toolInput.blocks as Block[] },
          userId,
        );
        break;
      }
      case 'update_item_template': {
        result = await runUpdateItemTemplate({
          template_id: toolInput.template_id as string,
          blocks: toolInput.blocks as Block[],
          name: toolInput.name as string | undefined,
        });
        break;
      }
      case 'update_space':
        result = await updateProject(
          {
            space_id: (toolInput.space_id as string | undefined) ?? (toolInput.project_id as string),
            name: toolInput.name as string | undefined,
            description: toolInput.description as string | undefined,
          },
          userId
        );
        break;
      case 'delete_space':
        result = await deleteProject(
          {
            space_id: (toolInput.space_id as string | undefined) ?? (toolInput.project_id as string),
            delete_files: toolInput.delete_files as boolean,
          },
          userId,
          executionId
        );
        break;
      case 'list_plans': {
        const lcPid = (toolInput.space_id as string | undefined) ?? (toolInput.project_id as string);
        if (!getSpaceForUser(lcPid, userId)) { result = `Error: space ${lcPid} not found`; break; }
        const summaries = getPlanSummaries(lcPid);
        result = JSON.stringify(summaries.map(p => ({
          id: p.id,
          title: p.title,
          status: p.status,
          total_steps: p.total_tasks,
          done_steps: p.done_tasks,
          error_steps: p.error_tasks,
          created_at: p.created_at,
          completed_at: p.completed_at,
        })), null, 2);
        break;
      }
      case 'get_plan': {
        const plan = getPlanById(toolInput.plan_id as string);
        if (!plan) { result = `Error: plan ${toolInput.plan_id} not found`; break; }
        const steps = getPlanSteps(plan.id);
        result = JSON.stringify({
          id: plan.id,
          title: plan.title,
          status: plan.status,
          created_at: plan.created_at,
          completed_at: plan.completed_at,
          steps: steps.map(s => ({
            id: s.id,
            title: s.title,
            agent: s.agent,
            status: s.status,
            execution_id: s.execution_id,
            result: null as string | null,
          })),
        }, null, 2);
        // attach result strings from executions (truncated — use get_execution_output for full log)
        const SUMMARY_CAP = 500;
        const parsed = JSON.parse(result) as { steps: Array<{ execution_id: string | null; result: string | null }> };
        for (const s of parsed.steps) {
          if (s.execution_id) {
            const ex = getExecutionById(s.execution_id);
            const r = ex?.result ?? null;
            s.result = r && r.length > SUMMARY_CAP ? r.slice(0, SUMMARY_CAP) + '…(use get_execution_output for full output)' : r;
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
      case 'resume_plan': {
        const resumed = resumePlan(toolInput.plan_id as string);
        if (!resumed) { result = `Error: plan ${toolInput.plan_id} not found or cannot be resumed (cancelled plans cannot be resumed)`; break; }
        result = JSON.stringify({
          id: resumed.plan.id,
          title: resumed.plan.title,
          status: resumed.plan.status,
          steps: resumed.steps.map(s => ({ id: s.id, title: s.title, agent: s.agent, status: s.status, execution_id: s.execution_id })),
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
      case 'create_plan': {
        result = runCreatePlan(
          {
            space_id: toolInput.space_id as string,
            title: toolInput.title as string,
            steps: toolInput.steps as Array<{ title: string; agent: 'claude_code' | 'codex' | 'mcp' | 'file_write' | 'git' | 'github' }>,
            session_id: sessionId,
          },
          userId
        );
        try {
          const parsed = JSON.parse(result) as { plan_id?: string; space_id?: string };
          const parsedSpaceId = parsed.space_id;
          if (parsed.plan_id && parsedSpaceId) {
            emitSessionEvent(userId, {
              sessionId,
              type: 'plan_created',
              title: `Created plan: ${toolInput.title as string}`,
              body: 'Tracks agent work from this chat.',
              spaceId: parsedSpaceId,
              planId: parsed.plan_id,
              executionId,
              metadata: { source: 'agent' },
            });
          }
        } catch { /* ignore malformed tool result */ }
        break;
      }
      case 'run_plan': {
        const runPlanId = toolInput.plan_id as string;
        const onError = (toolInput.on_error as 'stop' | 'continue' | undefined) ?? 'stop';
        const planCheck = getPlanById(runPlanId);
        if (!planCheck) { result = `Error: plan ${runPlanId} not found`; break; }
        const summary = await runPlanAutoDispatch(runPlanId, userId, messageId, sessionId, onError);
        const finalPlan = getPlanById(runPlanId)!;
        result = JSON.stringify({ plan_id: runPlanId, status: finalPlan.status, ...summary });
        break;
      }
      case 'create_pipeline': {
        const pipelineSpaceId = (toolInput.space_id as string | undefined) ?? spaceId;
        const pipelineSpace = getSpaceForUser(pipelineSpaceId, userId);
        if (!pipelineSpace) { result = `Error: space ${pipelineSpaceId} not found`; break; }
        const pTitle = toolInput.title as string;
        const pDesc = toolInput.description as string | undefined ?? null;
        const pTasks = toolInput.tasks as Array<{ title: string; agent: DbPlanStep['agent']; prompt?: string; depends_on?: number[]; tool_args?: Record<string, unknown> }>;
        const { pipeline, tasks: pipelineTasks } = createPipeline(pipelineSpaceId, pTitle, pDesc, pTasks);
        result = JSON.stringify({
          pipeline_id: pipeline.id,
          space_id: pipeline.space_id,
          title: pipeline.title,
          tasks: pipelineTasks.map(t => ({ id: t.id, title: t.title, agent: t.agent, position: t.position })),
        });
        break;
      }
      case 'run_pipeline': {
        const pipelineId = toolInput.pipeline_id as string;
        const pTitleOverride = toolInput.title as string | undefined;
        const pOnError = (toolInput.on_error as 'stop' | 'continue' | undefined) ?? 'stop';

        const pipeline = getPipelineById(pipelineId, userId);
        if (!pipeline) { result = `Error: pipeline ${pipelineId} not found`; break; }
        const ptasks = getPipelineTasks(pipelineId);

        // Instantiate pipeline as a plan — resolve position-based depends_on to step IDs
        const { plan: pPlan, steps: pSteps } = createPlan(
          pipeline.space_id,
          sessionId,
          pTitleOverride ?? pipeline.title,
          ptasks.map((pt) => ({
            title: pt.title,
            agent: pt.agent,
            prompt: pt.prompt,
            depends_on: pt.depends_on ? (JSON.parse(pt.depends_on) as number[]) : [],
            tool_args: pt.tool_args ? JSON.parse(pt.tool_args) : undefined,
          })),
        );

        broadcast(userId, { type: 'plan_created', planId: pPlan.id });

        const pSummary = await runPlanAutoDispatch(pPlan.id, userId, messageId, sessionId, pOnError);
        const pFinalPlan = getPlanById(pPlan.id)!;
        result = JSON.stringify({ plan_id: pPlan.id, pipeline_id: pipelineId, status: pFinalPlan.status, ...pSummary });
        break;
      }
      case 'delegate_to_agent': {
        const daInstructions = toolInput.instructions as string;
        const daProjectId = (toolInput.space_id as string | undefined) ?? (toolInput.project_id as string | undefined) ?? null;
        const daStepId = toolInput.plan_step_id as string | undefined;
        const daPlanId = daStepId ? getPlanForStep(daStepId)?.id ?? null : null;
        result = await runSubAgent(daInstructions, daProjectId, userId, executionId, messageId, sessionId, daPlanId, toolInput.max_turns as number | undefined);
        break;
      }
      case 'generate_video': {
        const title = toolInput.title as string;
        const scenes = toolInput.scenes as VideoScene[];
        const videoStepId = toolInput.plan_step_id as string | undefined;
        if (videoStepId) startPlanStep(userId, videoStepId, executionId);
        renderVideo(spaceId, title, scenes, (progress) => {
          appendOutput(executionId, userId, `progress:${Math.round(progress * 100)}%\n`);
        }, {
          session_id: sessionId,
          plan_id: videoStepId ? getPlanForStep(videoStepId)?.id ?? null : null,
          step_id: videoStepId ?? null,
        })
          .then((fileName) => {
            const r = `Rendered ${fileName}`;
            completeExecution(executionId, userId, 'done', r);
            if (videoStepId) finishPlanStep(userId, videoStepId, r);
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            completeExecution(executionId, userId, 'error', msg);
            if (videoStepId) finishPlanStep(userId, videoStepId, `Error: ${msg}`);
          });
        // Return early — completeExecution is handled by the fire-and-forget above
        return JSON.stringify({
          execution_id: executionId,
          status: 'started',
          message: 'Video render started. Call wait_for_execution with this execution_id to await completion, then list Space items.',
        });
      }
      case 'wait_for_execution': {
        const waitExecId = toolInput.execution_id as string;
        const timeoutSecs = Math.min(600, (toolInput.timeout_seconds as number | undefined) ?? 300);
        const deadline = Date.now() + timeoutSecs * 1000;

        let waitResult: string | null = null;
        while (Date.now() < deadline) {
          const ex = getExecutionById(waitExecId);
          if (!ex) { waitResult = `Error: execution ${waitExecId} not found`; break; }
          if (ex.status === 'done' || ex.status === 'error') {
            const LOG_CAP = 8000;
            const log = ex.output_log ?? '';
            const output_log = log.length > LOG_CAP ? `[truncated — showing last ${LOG_CAP} of ${log.length} chars]\n${log.slice(-LOG_CAP)}` : log;
            waitResult = JSON.stringify({ id: ex.id, tool: ex.tool, status: ex.status, result: ex.result, output_log });
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        result = waitResult ?? `Error: execution ${waitExecId} still running after ${timeoutSecs}s timeout`;
        break;
      }
      default: {
        const registryResult = await dispatchRegistryTool(userId, toolName, toolInput);
        if (registryResult !== undefined) {
          // Self-healing: the model called a registry tool that wasn't in its
          // pinned discovered set (hallucinated name or lost session state).
          // Pin it now so subsequent turns see its schema without re-searching.
          addSessionDiscoveredTools(sessionId, [toolName]);
        }
        result = registryResult ?? `Unknown tool: ${toolName}`;
      }
    }

    completeExecution(executionId, userId, 'done', result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    completeExecution(executionId, userId, 'error', msg);
    const catchStepId = toolInput.plan_step_id as string | undefined;
    if (catchStepId) finishPlanStep(userId, catchStepId, `Error: ${msg}`);
    return `Error: ${msg}`;
  }
}

export async function runAgentTurn(userId: string, sessionId: string, userMessageId: string): Promise<void> {
  const provider = await getConversationProvider(userId);

  const session = getDb()
    .prepare('SELECT model, provider_session_id FROM sessions WHERE id = ?')
    .get(sessionId) as { model: string | null; provider_session_id: string | null } | undefined;

  const lastUserMsg = getDb()
    .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1")
    .get(sessionId) as { content: string } | undefined;

  const prompt = lastUserMsg?.content ?? '';
  const intent = classifyIntent(prompt);
  const systemPromptSuffix = buildContext(userId, sessionId, intent);

  const port = process.env.PORT ?? '3000';
  const mcpToken = generateMcpToken(userId);
  const mcpServers = {
    app: { url: `http://localhost:${port}/mcp`, headers: { Authorization: `Bearer ${mcpToken}` } },
  };

  const replyId = newId();
  const replyCreatedAt = Math.floor(Date.now() / 1000);
  let started = false;
  let fullText = '';

  const abortController = new AbortController();
  activeTurnControllers.set(sessionId, abortController);

  try {
    await provider.invoke({
      userId,
      prompt,
      resumeSessionId: session?.provider_session_id,
      systemPromptSuffix,
      mcpServers,
      model: session?.model ?? undefined,
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

  recordAgentUsage(userId, provider.type as AgentUsageTool, 0);

  maybeGenerateSessionTitle(userId, sessionId).catch(() => {});
  try {
    const anthropicKey = getAnthropicKey(userId);
    extractAndRemember(userId, sessionId, anthropicKey).catch(() => {});
    maybeDistill(userId, sessionId, anthropicKey).catch(() => {});
  } catch { /* no key — skip */ }
}
