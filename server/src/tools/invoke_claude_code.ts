import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { appendOutput, requestApproval } from '../services/executor.js';
import { registerProcess, unregisterProcess } from '../lib/process-registry.js';
import { DELEGATE_FRAMING, DELEGATE_TIMEOUT_MS } from './agent_framing.js';
import { claudePermissionArgs, getDelegateEnv, normalizePermissionProfile, type PermissionProfile } from '../services/permissions.js';

interface ClaudeCodeInput {
  prompt: string;
  model?: string;
}

export interface McpServerConfig {
  // stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // HTTP transport
  url?: string;
  headers?: Record<string, string>;
}

interface ToolContext {
  userId: string;
  executionId: string;
  repoPath?: string;   // optional — defaults to cwd for conversational sessions
  resumeSessionId?: string | null;
  mcpServers?: Record<string, McpServerConfig>;
  permissionProfile?: PermissionProfile;
  effort?: string;
  signal?: AbortSignal;
  onText?: (delta: string) => void;      // for streaming chat
  onSessionId?: (id: string) => void;
}

export interface ClaudeCodeResult {
  result: string;
  sessionId: string | null;
  costUsd: number;
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

  const profile = normalizePermissionProfile(ctx.permissionProfile);
  const args = ['--print', ...claudePermissionArgs(profile), '--output-format', 'stream-json', '--verbose'];
  let mcpConfigDir: string | null = null;
  if (input.model) args.push('--model', input.model);
  if (!ctx.resumeSessionId) args.push('--append-system-prompt', DELEGATE_FRAMING);
  if (ctx.resumeSessionId) args.push('--resume', ctx.resumeSessionId);
  if (ctx.mcpServers && Object.keys(ctx.mcpServers).length > 0) {
    mcpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unnamed-claude-mcp-'));
    const mcpConfigPath = path.join(mcpConfigDir, 'mcp.json');
    const servers: Record<string, unknown> = {};
    for (const [name, cfg] of Object.entries(ctx.mcpServers)) {
      if (cfg.url) {
        servers[name] = { type: 'http', url: cfg.url, ...(cfg.headers ? { headers: cfg.headers } : {}) };
      } else {
        servers[name] = { command: cfg.command, args: cfg.args ?? [], env: cfg.env ?? {} };
      }
    }
    await fs.writeFile(mcpConfigPath, JSON.stringify({ mcpServers: servers }));
    args.push('--mcp-config', mcpConfigPath);
  }
  args.push('--');
  args.push(input.prompt);

  return new Promise((resolve, reject) => {
    const spawnEnv = getDelegateEnv('claude_code', profile);
    if (ctx.effort) spawnEnv.CLAUDE_EFFORT = ctx.effort;
    const proc = spawn('claude', args, {
      cwd: ctx.repoPath ?? process.cwd(),
      env: spawnEnv,
    });

    registerProcess(ctx.executionId, proc);

    ctx.signal?.addEventListener('abort', () => {
      proc.kill('SIGTERM');
    }, { once: true });

    let buffer = '';
    let sessionId: string | null = null;
    let sessionIdFired = false;
    let resultText = '';
    let costUsd = 0;
    let stderrText = '';
    let timedOut = false;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (proc.exitCode === null) proc.kill('SIGKILL');
      }, 5000);
    }, DELEGATE_TIMEOUT_MS);

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let event: Record<string, unknown>;
        try { event = JSON.parse(line); } catch { continue; }

        if (typeof event.session_id === 'string') {
          sessionId = event.session_id;
          if (!sessionIdFired && ctx.onSessionId) {
            sessionIdFired = true;
            ctx.onSessionId(event.session_id);
          }
        }

        if (event.type === 'assistant') {
          const msg = event.message as { content?: Array<{ type: string; name?: string; input?: Record<string, unknown>; text?: string }> } | undefined;
          for (const block of msg?.content ?? []) {
            if (block.type === 'tool_use' && block.name) {
              appendOutput(ctx.executionId, ctx.userId, `→ ${summarizeToolUse(block.name, block.input ?? {})}\n`);
            }
            if (block.type === 'text' && block.text) {
              appendOutput(ctx.executionId, ctx.userId, block.text);
              ctx.onText?.(block.text);
            }
          }
        }

        if (event.type === 'result') {
          resultText = typeof event.result === 'string' ? event.result : '';
          if (typeof event.session_id === 'string') sessionId = event.session_id;
          if (typeof event.total_cost_usd === 'number') costUsd = event.total_cost_usd;
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrText += chunk.toString();
      appendOutput(ctx.executionId, ctx.userId, chunk.toString());
    });

    proc.on('error', err => {
      clearTimeout(timeoutTimer);
      unregisterProcess(ctx.executionId);
      if (mcpConfigDir) void fs.rm(mcpConfigDir, { recursive: true, force: true });
      reject(new Error(`Failed to launch claude: ${err.message}. Is the Claude Code CLI installed and on PATH?`));
    });

    proc.on('close', code => {
      clearTimeout(timeoutTimer);
      unregisterProcess(ctx.executionId);
      if (mcpConfigDir) void fs.rm(mcpConfigDir, { recursive: true, force: true });
      if (timedOut) {
        reject(new Error(`claude timed out after ${DELEGATE_TIMEOUT_MS / 1000}s and was killed`));
        return;
      }
      if (code !== 0 && !resultText) {
        reject(new Error(`claude exited with code ${code}${stderrText.trim() ? `: ${stderrText.trim()}` : ''}`));
        return;
      }
      resolve({ result: resultText || 'Done.', sessionId, costUsd });
    });
  });
}
