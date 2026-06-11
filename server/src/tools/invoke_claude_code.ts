import { spawn } from 'child_process';
import { appendOutput, requestApproval } from '../services/executor.js';
import { registerProcess, unregisterProcess } from '../lib/process-registry.js';
import { DELEGATE_FRAMING } from './agent_framing.js';

interface ClaudeCodeInput {
  prompt: string;
}

interface McpServerConfig { command: string; args?: string[]; env?: Record<string, string> }

interface ToolContext {
  userId: string;
  executionId: string;
  repoPath: string;
  apiKey: string | null;
  resumeSessionId?: string | null;
  mcpServers?: Record<string, McpServerConfig>;
}

export interface ClaudeCodeResult {
  result: string;
  sessionId: string | null;
}

function summarizeToolUse(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': return `Read ${input.file_path}`;
    case 'Edit': return `Edit ${input.file_path}`;
    case 'Write': return `Write ${input.file_path}`;
    case 'MultiEdit': return `Edit ${input.file_path}`;
    case 'Bash': return `Run: ${String(input.command ?? '').slice(0, 80)}`;
    case 'WebFetch': return `Fetch ${input.url}`;
    case 'WebSearch': return `Search: ${input.query}`;
    case 'TodoWrite': return 'Update todos';
    case 'Agent': return 'Spawn subagent';
    default: return name;
  }
}

export async function invokeClaudeCode(input: ClaudeCodeInput, ctx: ToolContext): Promise<ClaudeCodeResult> {
  await requestApproval(ctx.executionId, ctx.userId, 'invoke_claude_code', { prompt: input.prompt }, 'agent');

  const args = ['--print', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose'];
  if (!ctx.resumeSessionId) args.push('--append-system-prompt', DELEGATE_FRAMING);
  if (ctx.resumeSessionId) args.push('--resume', ctx.resumeSessionId);
  if (ctx.mcpServers && Object.keys(ctx.mcpServers).length > 0) {
    args.push('--mcp-config', JSON.stringify({ mcpServers: ctx.mcpServers }));
  }
  args.push(input.prompt);

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      cwd: ctx.repoPath,
      env: ctx.apiKey ? { ...process.env, ANTHROPIC_API_KEY: ctx.apiKey } : process.env,
    });

    registerProcess(ctx.executionId, proc);

    let buffer = '';
    let sessionId: string | null = null;
    let resultText = '';
    let stderrText = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let event: Record<string, unknown>;
        try { event = JSON.parse(line); } catch { continue; }

        if (typeof event.session_id === 'string') sessionId = event.session_id;

        if (event.type === 'assistant') {
          const msg = event.message as { content?: Array<{ type: string; name?: string; input?: Record<string, unknown>; text?: string }> } | undefined;
          for (const block of msg?.content ?? []) {
            if (block.type === 'tool_use' && block.name) {
              appendOutput(ctx.executionId, ctx.userId, `→ ${summarizeToolUse(block.name, block.input ?? {})}\n`);
            }
            if (block.type === 'text' && block.text) {
              appendOutput(ctx.executionId, ctx.userId, block.text);
            }
          }
        }

        if (event.type === 'result') {
          resultText = typeof event.result === 'string' ? event.result : '';
          if (typeof event.session_id === 'string') sessionId = event.session_id;
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrText += chunk.toString();
      appendOutput(ctx.executionId, ctx.userId, chunk.toString());
    });

    proc.on('error', err => {
      unregisterProcess(ctx.executionId);
      reject(new Error(`Failed to launch claude: ${err.message}. Is the Claude Code CLI installed and on PATH?`));
    });

    proc.on('close', code => {
      unregisterProcess(ctx.executionId);
      if (code !== 0 && !resultText) {
        reject(new Error(`claude exited with code ${code}${stderrText.trim() ? `: ${stderrText.trim()}` : ''}`));
        return;
      }
      resolve({ result: resultText || 'Done.', sessionId });
    });
  });
}
