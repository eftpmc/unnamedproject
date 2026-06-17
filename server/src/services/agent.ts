import Anthropic from '@anthropic-ai/sdk';
import { exec as execCallback } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';
import { createSessionEvent, getDb, getProjectForUser, linkSessionProject, setAgentWorktreeSession, updatePlanStepStatus, maybeCompletePlan, getPlanForStep, getPlanSummaries, getPlanById, getPlanSteps, getExecutionById, getScheduledTasksForUser, createScheduledTask, updateScheduledTask, deleteScheduledTask, resumePlan, getPermissionProfile, createPipeline, getPipelineById, getPipelineTasks, listPipelinesForUser, createPlan, recordAgentUsage, type DbPlan, type DbPlanStep } from '../db/index.js';

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
import { createProject, updateProject, deleteProject } from '../tools/project_ops.js';
import { runCreatePlan } from '../tools/create_plan.js';
import { broadcast } from './socket.js';
import { newId } from '../lib/ids.js';
import { DEFAULT_EFFORT, getAnthropicKey, resolveModelForTurn, listClaudeModels, tokensToUsd, type EffortLevel } from './anthropic.js';
import { classifyIntent } from './intent.js';
import { buildContext } from './context.js';
import { toolDefinitions } from '../tools/definitions.js';
import { extractAndRemember } from './extract-memory.js';
import { renderVideo, type VideoScene } from './video.js';
import { createTextArtifact, listProjectArtifacts, getArtifactById, readArtifactContent, registerFileAsArtifact } from './artifacts.js';
import { listMcpTools } from '../lib/mcp-pool.js';
import { maybeDistill } from './distill.js';

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

  const MAX_RESULT_CHARS = 2000;
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
  'list_artifacts',
  'read_artifact',
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
]);

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

function noteProjectUse(userId: string, sessionId: string, project: { id: string; name: string }, executionId?: string): void {
  let linked = false;
  try {
    linked = linkSessionProject(sessionId, project.id, 'agent');
  } catch (err) {
    console.error('noteProjectUse: linkSessionProject failed (non-fatal):', err);
    return;
  }
  if (!linked) return;
  emitSessionEvent(userId, {
    sessionId,
    type: 'project_linked',
    title: `Scoped to ${project.name}`,
    body: 'The agent attached this chat to a project automatically.',
    projectId: project.id,
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

  const SUB_TOOLS = new Set(['read_file', 'list_dir', 'search_files', 'project_query', 'recall', 'remember', 'write_file', 'create_artifact', 'git_op', 'list_artifacts', 'read_artifact']);
  const subtools = toolDefinitions.filter(t => 'name' in t && SUB_TOOLS.has(t.name as string));

  const systemPrompt = `You are a focused sub-agent completing a specific task.${projectId ? ` Use project_id "${projectId}" when calling project tools.` : ''} Complete the task fully, then respond with a clear summary of what you accomplished.`;

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: instructions }];
  const SUB_MODEL = 'claude-sonnet-4-6';
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

    const response = await client.messages.create({
      model: SUB_MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      tools: subtools as Anthropic.Tool[],
      messages,
    });

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
  const project = getProjectForUser(plan.project_id, userId);
  if (!project) throw new Error(`Project ${plan.project_id} not found`);

  const executionId = createExecution(userId, messageId, project.id, step.agent);
  startPlanStep(userId, step.id, executionId);

  const toolArgs: Record<string, unknown> = step.tool_args ? JSON.parse(step.tool_args) : {};
  const prompt = step.prompt ?? '';
  const priorCtx = buildPlanPriorContext(step.id);
  const fullPrompt = priorCtx ? `${prompt}\n\n${priorCtx}` : prompt;

  try {
    let result: string;

    switch (step.agent) {
      case 'claude_code': {
        if (!project.repo_path) throw new Error(`Project '${project.name}' has no repo`);
        let apiKey: string | null = null;
        try { apiKey = getAnthropicKey(userId); } catch { /* use CLI auth */ }
        const worktree = await ensureWorktree(project, sessionId);
        let graphKey: string | null = null;
        try { graphKey = getAnthropicKey(userId); } catch {}
        const ctx: AgentPipelineCtx = { userId, tool: 'claude_code', repoPath: project.repo_path, projectId: project.id, graphKey };
        await runAgentPipeline(ctx, async () => {
          const r = await invokeClaudeCode(
            { prompt: fullPrompt },
            { userId, executionId, repoPath: worktree.worktree_path, apiKey, resumeSessionId: worktree.claude_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId), onSessionId: (id) => setAgentWorktreeSession(worktree.id, 'claude', id) },
          );
          ctx.result = r.result;
          ctx.costUsd = r.costUsd;
        });
        result = ctx.result!;
        break;
      }
      case 'codex': {
        if (!project.repo_path) throw new Error(`Project '${project.name}' has no repo`);
        const connIds: string[] = JSON.parse(project.enabled_connection_ids ?? '[]');
        let codexKey: string | null = null;
        if (connIds.length > 0) {
          const openaiConn = getDb()
            .prepare(`SELECT id FROM connections WHERE id IN (${connIds.map(() => '?').join(',')}) AND type = 'openai' LIMIT 1`)
            .get(...connIds) as { id: string } | undefined;
          if (openaiConn) {
            codexKey = getDecryptedConfig(openaiConn.id, userId).apiKey;
          }
        }
        const cWorktree = await ensureWorktree(project, sessionId);
        let cGraphKey: string | null = null;
        try { cGraphKey = getAnthropicKey(userId); } catch {}
        const cCtx: AgentPipelineCtx = { userId, tool: 'codex', repoPath: project.repo_path, projectId: project.id, graphKey: cGraphKey };
        await runAgentPipeline(cCtx, async () => {
          const cr = await invokeCodex(
            { prompt: fullPrompt },
            { userId, executionId, repoPath: cWorktree.worktree_path, apiKey: codexKey, resumeSessionId: cWorktree.codex_session_id, mcpServers: getMcpServersForUser(userId), permissionProfile: getPermissionProfile(userId), onSessionId: (id) => setAgentWorktreeSession(cWorktree.id, 'codex', id) },
          );
          cCtx.result = cr.result;
          cCtx.costUsd = cr.costUsd;
        });
        result = cCtx.result!;
        break;
      }
      case 'eval': {
        if (!project.repo_path) throw new Error(`Project '${project.name}' has no repo for eval`);
        const evalBlocked = isBlocked(prompt);
        if (evalBlocked) throw new Error(evalBlocked);
        const evalWorktree = await ensureWorktree(project, sessionId);
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
        result = await runSubAgent(fullPrompt, plan.project_id, userId, executionId, messageId, sessionId, plan.id);
        break;
      }
      case 'git': {
        if (!project.repo_path) throw new Error(`Project '${project.name}' has no repo`);
        const gitWorktree = await ensureWorktree(project, sessionId);
        result = await runGitOp(
          {
            op: (toolArgs.op as 'log' | 'diff' | 'status' | 'commit' | 'push') ?? 'commit',
            message: (toolArgs.message as string | undefined) ?? prompt,
            branch: (toolArgs.branch as string | undefined) ?? gitWorktree.branch,
          },
          { userId, executionId, projectId: project.id, repoPath: gitWorktree.worktree_path },
        );
        break;
      }
      case 'github': {
        result = 'Error: github step type is no longer supported. Configure the GitHub MCP server in Settings → MCP and use agent type "mcp" with the appropriate tool_name instead.';
        break;
      }
      case 'file_write': {
        result = await writeFile(
          { project_id: project.id, path: toolArgs.path as string, content: (toolArgs.content as string) ?? prompt },
          { userId, executionId, projectId: project.id, sessionId, permissionProfile: getPermissionProfile(userId) },
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
  const projectId = (toolInput.project_id as string | undefined) ?? 'unknown';
  const project = getProjectForUser(projectId, userId);
  const executionId = createExecution(userId, messageId, project?.id ?? null, toolName);
  if (project) noteProjectUse(userId, sessionId, project, executionId);

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
        const ccStepId = toolInput.plan_step_id as string | undefined;
        if (ccStepId) startPlanStep(userId, ccStepId, executionId);
        let ccGraphKey: string | null = null;
        try { ccGraphKey = getAnthropicKey(userId); } catch { /* none configured */ }
        const ccCtx: AgentPipelineCtx = { userId, tool: 'claude_code', repoPath: project.repo_path, projectId: project.id, graphKey: ccGraphKey };
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
        const codexStepId = toolInput.plan_step_id as string | undefined;
        if (codexStepId) startPlanStep(userId, codexStepId, executionId);
        let codexGraphKey: string | null = null;
        try { codexGraphKey = getAnthropicKey(userId); } catch { /* none configured */ }
        const codexCtx: AgentPipelineCtx = { userId, tool: 'codex', repoPath: project.repo_path, projectId: project.id, graphKey: codexGraphKey };
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
      case 'mcp_call': {
        const mcpConn = getDb()
          .prepare("SELECT id FROM connections WHERE id = ? AND user_id = ? AND type = 'mcp'")
          .get(toolInput.connection_id as string, userId) as { id: string } | undefined;
        if (!mcpConn) {
          result = `Error: MCP connection ${toolInput.connection_id as string} not found`;
          break;
        }
        const mcpConfig = getDecryptedConfig(mcpConn.id, userId);
        const mcpStepId = toolInput.plan_step_id as string | undefined;
        if (mcpStepId) startPlanStep(userId, mcpStepId, executionId);
        result = await callMcpTool(
          toolInput.connection_id as string,
          mcpConfig.command,
          mcpConfig.args ? JSON.parse(mcpConfig.args) : [],
          mcpConfig.env ? JSON.parse(mcpConfig.env) : {},
          toolInput.tool_name as string,
          toolInput.tool_input as Record<string, unknown>,
        );
        if (mcpStepId) finishPlanStep(userId, mcpStepId, result);
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
        const gitStepId = toolInput.plan_step_id as string | undefined;
        if (gitStepId) startPlanStep(userId, gitStepId, executionId);
        result = await runGitOp(
          { op: toolInput.op as 'log' | 'diff' | 'status' | 'commit' | 'push', message: toolInput.message as string | undefined, branch: toolInput.branch as string | undefined ?? gitWorktree.branch },
          { userId, executionId, projectId, repoPath: gitWorktree.worktree_path }
        );
        if (gitStepId) finishPlanStep(userId, gitStepId, result);
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
        const regStepId = toolInput.plan_step_id as string | undefined;
        if (regStepId) startPlanStep(userId, regStepId, executionId);
        const art = await registerFileAsArtifact({
          project_id: toolInput.project_id as string,
          source_path: toolInput.file_path as string,
          title: toolInput.title as string | undefined,
          kind: toolInput.kind as string | undefined,
        });
        result = JSON.stringify({ artifact_id: art.id, project_id: toolInput.project_id as string, title: art.title, kind: art.kind, mime_type: art.mime_type, url: art.url });
        if (regStepId) finishPlanStep(userId, regStepId, result);
        break;
      }
      case 'list_artifacts': {
        const pid = toolInput.project_id as string;
        if (!getProjectForUser(pid, userId)) { result = `Error: project ${pid} not found`; break; }
        const artifacts = listProjectArtifacts(pid);
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
      case 'run_command': {
        const rcStepId = toolInput.plan_step_id as string | undefined;
        if (rcStepId) startPlanStep(userId, rcStepId, executionId);
        result = await runCommand(
          {
            command: toolInput.command as string,
            project_id: toolInput.project_id as string | undefined,
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
          { project_id: projectId, path: toolInput.path as string, content: toolInput.content as string },
          { userId, executionId, projectId, sessionId, permissionProfile: getPermissionProfile(userId) }
        );
        if (writeStepId) finishPlanStep(userId, writeStepId, result);
        break;
      }
      case 'create_artifact': {
        const artifactStepId = toolInput.plan_step_id as string | undefined;
        if (artifactStepId) startPlanStep(userId, artifactStepId, executionId);
        const artifact = await createTextArtifact({
          project_id: projectId,
          kind: toolInput.kind as string,
          title: toolInput.title as string,
          description: toolInput.description as string | undefined,
          content: toolInput.content as string,
          mime_type: toolInput.mime_type as 'text/markdown' | 'text/plain' | 'application/json' | undefined,
          status: toolInput.status as 'ready' | 'review' | 'running' | 'error' | undefined,
          source_step_id: artifactStepId ?? null,
          metadata: { producer: 'create_artifact', execution_id: executionId },
        });
        result = JSON.stringify({ artifact_id: artifact.id, project_id: projectId, title: artifact.title, kind: artifact.kind, mime_type: artifact.mime_type });
        emitSessionEvent(userId, {
          sessionId,
          type: 'artifact_created',
          title: `Created artifact: ${artifact.title}`,
          body: artifact.kind,
          projectId,
          artifactId: artifact.id,
          executionId,
          metadata: { kind: artifact.kind, mime_type: artifact.mime_type },
        });
        if (artifactStepId) finishPlanStep(userId, artifactStepId, result);
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
            try { linkSessionProject(sessionId, createdProject.id, 'agent'); }
            catch (err) { console.error('create_project: linkSessionProject failed (non-fatal):', err); }
            emitSessionEvent(userId, {
              sessionId,
              type: 'project_created',
              title: `Created project: ${createdProject.name}`,
              body: 'Created from this chat.',
              projectId: createdProject.id,
              executionId,
              metadata: { source: 'agent' },
            });
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
      case 'list_plans': {
        const lcPid = toolInput.project_id as string;
        if (!getProjectForUser(lcPid, userId)) { result = `Error: project ${lcPid} not found`; break; }
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
            project_id: toolInput.project_id as string,
            title: toolInput.title as string,
            steps: toolInput.steps as Array<{ title: string; agent: 'claude_code' | 'codex' | 'mcp' | 'file_write' | 'git' | 'github' }>,
            session_id: sessionId,
          },
          userId
        );
        try {
          const parsed = JSON.parse(result) as { plan_id?: string; project_id?: string };
          if (parsed.plan_id && parsed.project_id) {
            emitSessionEvent(userId, {
              sessionId,
              type: 'plan_created',
              title: `Created plan: ${toolInput.title as string}`,
              body: 'Tracks agent work from this chat.',
              projectId: parsed.project_id,
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
        const pTitle = toolInput.title as string;
        const pDesc = toolInput.description as string | undefined ?? null;
        const pTasks = toolInput.tasks as Array<{ title: string; agent: DbPlanStep['agent']; prompt?: string; depends_on?: number[]; tool_args?: Record<string, unknown> }>;
        const { pipeline, tasks: pipelineTasks } = createPipeline(userId, pTitle, pDesc, pTasks);
        result = JSON.stringify({
          pipeline_id: pipeline.id,
          title: pipeline.title,
          tasks: pipelineTasks.map(t => ({ id: t.id, title: t.title, agent: t.agent, position: t.position })),
        });
        break;
      }
      case 'run_pipeline': {
        const pipelineId = toolInput.pipeline_id as string;
        const pProjectId = toolInput.project_id as string;
        const pTitleOverride = toolInput.title as string | undefined;
        const pOnError = (toolInput.on_error as 'stop' | 'continue' | undefined) ?? 'stop';

        const pipeline = getPipelineById(pipelineId, userId);
        if (!pipeline) { result = `Error: pipeline ${pipelineId} not found`; break; }
        const ptasks = getPipelineTasks(pipelineId);

        // Instantiate pipeline as a plan — resolve position-based depends_on to step IDs
        const { plan: pPlan, steps: pSteps } = createPlan(
          pProjectId,
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
        const daProjectId = toolInput.project_id as string | undefined ?? null;
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
        renderVideo(projectId, title, scenes, (progress) => {
          appendOutput(executionId, userId, `progress:${Math.round(progress * 100)}%\n`);
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
          message: 'Video render started. Call wait_for_execution with this execution_id to await completion, then check project Artifacts.',
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
      default:
        result = `Unknown tool: ${toolName}`;
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
    .prepare('SELECT id, role, content FROM messages WHERE session_id = ? ORDER BY created_at')
    .all(sessionId) as DbMessage[];

  const attachments = history.length
    ? getDb()
      .prepare(`
        SELECT a.message_id as messageId, a.filename, a.mime_type as mimeType,
               a.size_bytes as sizeBytes, a.storage_path as storagePath
        FROM message_attachments a
        WHERE a.message_id IN (${history.map(() => '?').join(',')})
        ORDER BY a.created_at, a.filename
      `)
      .all(...history.map(m => m.id)) as DbMessageAttachment[]
    : [];
  const attachmentsByMessage = new Map<string, DbMessageAttachment[]>();
  for (const attachment of attachments) {
    const list = attachmentsByMessage.get(attachment.messageId) ?? [];
    list.push(attachment);
    attachmentsByMessage.set(attachment.messageId, list);
  }

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
    content: m.role === 'user'
      ? buildMessageContent(m.content, attachmentsByMessage.get(m.id) ?? [])
      : m.content,
  }));

  if (session?.summary && messages.length > 0) {
    messages.unshift(
      { role: 'user', content: `Earlier in this session: ${session.summary}` },
      { role: 'assistant', content: `Session context noted.` },
    );
  }

  let currentMessages = [...messages];

  const replyId = newId();
  let fullText = '';
  let started = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const abortController = new AbortController();
  activeTurnControllers.set(sessionId, abortController);

  try {
    while (true) {
      if (abortController.signal.aborted) break;
      const stream = client.messages.stream({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        tools: tools,
        messages: currentMessages,
      }, {
        headers: { 'anthropic-beta': 'web-fetch-2025-09-10' },
        signal: abortController.signal,
      });

      stream.on('text', (delta) => {
        if (!started) {
          started = true;
          getDb()
            .prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
            .run(replyId, sessionId, 'assistant', '');
          broadcast(userId, { type: 'message_started', sessionId, message: { id: replyId, role: 'assistant', content: '' } });
        }
        fullText += delta;
        broadcast(userId, { type: 'message_delta', sessionId, messageId: replyId, delta });
      });

      const response = await stream.finalMessage();
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

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
    const wasStopped = abortController.signal.aborted;
    if (started) {
      // Persist whatever was streamed so far rather than leaving an empty
      // assistant message in history (the API rejects empty assistant content).
      if (fullText) {
        getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(fullText, replyId);
        broadcast(userId, { type: 'message_created', sessionId, message: { id: replyId, role: 'assistant', content: fullText } });
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
    getDb()
      .prepare('UPDATE messages SET content = ? WHERE id = ?')
      .run(fullText, replyId);
    broadcast(userId, { type: 'message_created', sessionId, message: { id: replyId, role: 'assistant', content: fullText } });
  }

  getDb()
    .prepare("UPDATE session_turns SET status = 'done', completed_at = unixepoch() WHERE session_id = ? AND user_message_id = ? AND status = 'running'")
    .run(sessionId, userMessageId);
  getDb()
    .prepare('UPDATE sessions SET updated_at = unixepoch() WHERE id = ?')
    .run(sessionId);
  broadcast(userId, { type: 'turn_complete', sessionId, status: 'done', inputTokens: totalInputTokens });

  recordAgentUsage(userId, 'lead_agent', tokensToUsd(model, totalInputTokens, totalOutputTokens));

  // Fire-and-forget: generate title after first turn
  maybeGenerateSessionTitle(userId, sessionId).catch(() => {});

  extractAndRemember(userId, sessionId, apiKey).catch(() => {});
  maybeDistill(userId, sessionId, apiKey).catch(() => {});
}
