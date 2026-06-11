import Anthropic from '@anthropic-ai/sdk';
import { getDb, getProjectForUser, type DbProject } from '../db/index.js';
import { getDecryptedConfig } from '../routes/connections.js';
import { recallAll } from './memory.js';
import { toolDefinitions } from '../tools/definitions.js';
import { createExecution, completeExecution } from './executor.js';
import { runGitOp } from '../tools/git_op.js';
import { runGithubApi } from '../tools/github_api.js';
import { invokeClaudeCode } from '../tools/invoke_claude_code.js';
import { invokeCodex } from '../tools/invoke_codex.js';
import { callMcp } from '../tools/mcp_call.js';
import { runProjectQuery } from '../tools/project_query.js';
import { remember, recall } from '../tools/memory_tools.js';
import { readFile, listDir, writeFile } from '../tools/file_ops.js';
import { createProject, updateProject, deleteProject } from '../tools/project_ops.js';
import { broadcast } from './socket.js';
import { newId } from '../lib/ids.js';
import { DEFAULT_EFFORT, getAnthropicKey, resolveModelForEffort, type EffortLevel } from './anthropic.js';

interface DbMessage { role: string; content: string; }

function getProjects(userId: string): DbProject[] {
  return getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM projects WHERE user_id = ?')
    .all(userId) as DbProject[];
}

function buildSystemPrompt(userId: string): string {
  const memory = recallAll(userId);
  const projects = getProjects(userId);
  const memoryText = Object.keys(memory).length > 0
    ? `\n\nUser memory:\n${Object.entries(memory).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';
  const projectsText = projects.length > 0
    ? `\n\nAvailable projects:\n${projects.map(p => `- ${p.name} (id: ${p.id}${p.repo_path ? '' : ', no repo'})${p.description ? ': ' + p.description : ''}`).join('\n')}`
    : '\n\nNo projects yet.';

  return `You are a personal AI operator. You help the user plan, execute, and manage work across their projects and tools.

When the user gives you a task, determine which project it relates to. If no existing project fits and the task implies new code or files, call create_project yourself (pick a sensible name and description) rather than asking the user where to put things — only ask if it's genuinely ambiguous which existing project a task belongs to. For coding work, prefer invoke_claude_code or invoke_codex over manual file edits. Query project_query before dispatching coding tools to understand the codebase structure.

You can run tools in parallel when the tasks are independent.

Approval tiers:
- Agent-approved (automatic, logged): invoke_claude_code, invoke_codex, git commit, create_project, update_project
- User-approved (pauses for user): git push, github write ops, write_file, delete_project
Never skip a write op because approval is needed — just proceed and the system handles it.
${memoryText}
${projectsText}`;
}

async function dispatchTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string,
  messageId: string
): Promise<string> {
  const projectId = (toolInput.project_id as string | undefined) ?? 'unknown';
  const project = getProjectForUser(projectId, userId);
  const executionId = createExecution(userId, messageId, project?.id ?? null, toolName);

  try {
    let result: string;

    switch (toolName) {
      case 'invoke_claude_code': {
        const connectionIds: string[] = JSON.parse(project?.enabled_connection_ids ?? '[]');
        let apiKey = getAnthropicKey(userId);
        if (connectionIds.length > 0) {
          const anthropicConn = getDb()
            .prepare(`SELECT id FROM connections WHERE id IN (${connectionIds.map(() => '?').join(',')}) AND type = 'anthropic' LIMIT 1`)
            .get(...connectionIds) as { id: string } | undefined;
          if (anthropicConn) apiKey = getDecryptedConfig(anthropicConn.id).apiKey;
        }
        result = await invokeClaudeCode(
          { prompt: toolInput.prompt as string },
          { userId, executionId, repoPath: project?.repo_path ?? '/tmp', apiKey }
        );
        break;
      }
      case 'invoke_codex': {
        const connectionIds: string[] = JSON.parse(project?.enabled_connection_ids ?? '[]');
        let apiKey = '';
        if (connectionIds.length > 0) {
          const openaiConn = getDb()
            .prepare(`SELECT id FROM connections WHERE id IN (${connectionIds.map(() => '?').join(',')}) AND type = 'openai' LIMIT 1`)
            .get(...connectionIds) as { id: string } | undefined;
          if (openaiConn) apiKey = getDecryptedConfig(openaiConn.id).apiKey;
        }
        result = await invokeCodex(
          { prompt: toolInput.prompt as string },
          { userId, executionId, repoPath: project?.repo_path ?? '/tmp', apiKey }
        );
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
        const config = getDecryptedConfig(toolInput.connection_id as string);
        result = await callMcp(
          { tool_name: toolInput.tool_name as string, tool_input: toolInput.tool_input as Record<string, unknown> },
          { command: config.command, args: config.args ? JSON.parse(config.args) : [], env: config.env ? JSON.parse(config.env) : {} }
        );
        break;
      }
      case 'git_op': {
        result = await runGitOp(
          { op: toolInput.op as 'log' | 'diff' | 'status' | 'commit' | 'push', message: toolInput.message as string | undefined },
          { userId, executionId, projectId, repoPath: project?.repo_path ?? '/tmp' }
        );
        break;
      }
      case 'project_query':
        result = await runProjectQuery({ project_id: projectId, question: toolInput.question as string }, userId);
        break;
      case 'remember':
        result = remember(userId, toolInput.key as string, toolInput.value as string);
        break;
      case 'recall':
        result = recall(userId, (toolInput.key as string | undefined) ?? null);
        break;
      case 'read_file':
        result = await readFile({ project_id: projectId, path: toolInput.path as string }, { userId, executionId, projectId });
        break;
      case 'list_dir':
        result = await listDir({ project_id: projectId, path: toolInput.path as string | undefined }, { userId, executionId, projectId });
        break;
      case 'write_file':
        result = await writeFile(
          { project_id: projectId, path: toolInput.path as string, content: toolInput.content as string },
          { userId, executionId, projectId }
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
  const apiKey = getAnthropicKey(userId);
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

  const systemPrompt = buildSystemPrompt(userId);
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
            const result = await dispatchTool(block.name, block.input as Record<string, unknown>, userId, userMessageId);
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
}
