import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/index.js';
import { getDecryptedConfig } from '../routes/connections.js';
import { recallAll } from './memory.js';
import { toolDefinitions } from '../tools/definitions.js';
import { createExecution, completeExecution } from './executor.js';
import { runGitOp } from '../tools/git_op.js';
import { runGithubApi } from '../tools/github_api.js';
import { invokeClaudeCode } from '../tools/invoke_claude_code.js';
import { invokeCodex } from '../tools/invoke_codex.js';
import { callMcp } from '../tools/mcp_call.js';
import { runWorkspaceQuery } from '../tools/workspace_query.js';
import { remember, recall } from '../tools/memory_tools.js';
import { broadcast } from './socket.js';

interface DbMessage { role: string; content: string; }
interface DbWorkspace { id: string; name: string; description: string | null; repo_path: string | null; enabled_connection_ids: string; }

function getAnthropicKey(userId: string): string {
  const conn = getDb()
    .prepare("SELECT id FROM connections WHERE user_id = ? AND type = 'anthropic' ORDER BY created_at LIMIT 1")
    .get(userId) as { id: string } | undefined;
  if (!conn) throw new Error('No Anthropic connection configured');
  const config = getDecryptedConfig(conn.id);
  return config.apiKey;
}

function getWorkspaces(userId: string): DbWorkspace[] {
  return getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM workspaces WHERE user_id = ?')
    .all(userId) as DbWorkspace[];
}

function buildSystemPrompt(userId: string): string {
  const memory = recallAll(userId);
  const workspaces = getWorkspaces(userId);
  const memoryText = Object.keys(memory).length > 0
    ? `\n\nUser memory:\n${Object.entries(memory).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';
  const wsText = workspaces.length > 0
    ? `\n\nAvailable workspaces:\n${workspaces.map(w => `- ${w.name} (id: ${w.id})${w.description ? ': ' + w.description : ''}`).join('\n')}`
    : '\n\nNo workspaces configured yet.';

  return `You are a personal AI operator. You help the user plan, execute, and manage work across their projects and tools.

When the user gives you a task, determine which workspace it relates to (ask if unclear), then use the available tools to complete it. For coding work, prefer invoke_claude_code or invoke_codex over manual file edits. Query workspace_query before dispatching coding tools to understand the codebase structure.

You can run tools in parallel when the tasks are independent.

Approval tiers:
- Agent-approved (automatic, logged): invoke_claude_code, invoke_codex, git commit
- User-approved (pauses for user): git push, github write ops
Never skip a write op because approval is needed — just proceed and the system handles it.
${memoryText}
${wsText}`;
}

async function dispatchTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string,
  messageId: string
): Promise<string> {
  const workspaceId = (toolInput.workspace_id as string | undefined) ?? 'unknown';
  const executionId = createExecution(userId, messageId, workspaceId, toolName);

  try {
    let result: string;

    switch (toolName) {
      case 'invoke_claude_code': {
        const ws = getDb().prepare('SELECT repo_path, enabled_connection_ids FROM workspaces WHERE id = ?').get(workspaceId) as DbWorkspace | undefined;
        const connectionIds: string[] = JSON.parse(ws?.enabled_connection_ids ?? '[]');
        let apiKey = getAnthropicKey(userId);
        if (connectionIds.length > 0) {
          const anthropicConn = getDb()
            .prepare(`SELECT id FROM connections WHERE id IN (${connectionIds.map(() => '?').join(',')}) AND type = 'anthropic' LIMIT 1`)
            .get(...connectionIds) as { id: string } | undefined;
          if (anthropicConn) apiKey = getDecryptedConfig(anthropicConn.id).apiKey;
        }
        result = await invokeClaudeCode(
          { prompt: toolInput.prompt as string },
          { userId, executionId, repoPath: ws?.repo_path ?? '/tmp', apiKey }
        );
        break;
      }
      case 'invoke_codex': {
        const ws = getDb().prepare('SELECT repo_path, enabled_connection_ids FROM workspaces WHERE id = ?').get(workspaceId) as DbWorkspace | undefined;
        const connectionIds: string[] = JSON.parse(ws?.enabled_connection_ids ?? '[]');
        let apiKey = '';
        if (connectionIds.length > 0) {
          const openaiConn = getDb()
            .prepare(`SELECT id FROM connections WHERE id IN (${connectionIds.map(() => '?').join(',')}) AND type = 'openai' LIMIT 1`)
            .get(...connectionIds) as { id: string } | undefined;
          if (openaiConn) apiKey = getDecryptedConfig(openaiConn.id).apiKey;
        }
        result = await invokeCodex(
          { prompt: toolInput.prompt as string },
          { userId, executionId, repoPath: ws?.repo_path ?? '/tmp', apiKey }
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
        const ws = getDb().prepare('SELECT repo_path FROM workspaces WHERE id = ?').get(workspaceId) as { repo_path: string | null } | undefined;
        result = await runGitOp(
          { op: toolInput.op as 'log' | 'diff' | 'status' | 'commit' | 'push', message: toolInput.message as string | undefined },
          { userId, executionId, workspaceId, repoPath: ws?.repo_path ?? '/tmp' }
        );
        break;
      }
      case 'workspace_query':
        result = await runWorkspaceQuery({ workspace_id: workspaceId, question: toolInput.question as string });
        break;
      case 'remember':
        result = remember(userId, toolInput.key as string, toolInput.value as string);
        break;
      case 'recall':
        result = recall(userId, (toolInput.key as string | undefined) ?? null);
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

export async function runAgentTurn(userId: string, sessionId: string, userMessageId: string): Promise<string> {
  const apiKey = getAnthropicKey(userId);
  const client = new Anthropic({ apiKey });

  const history = getDb()
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at')
    .all(sessionId) as DbMessage[];

  const messages: Anthropic.MessageParam[] = history.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const systemPrompt = buildSystemPrompt(userId);
  let currentMessages = [...messages];

  while (true) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: toolDefinitions,
      messages: currentMessages,
    });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text');
      return textBlock ? (textBlock as Anthropic.TextBlock).text : '';
    }

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

  return '';
}
