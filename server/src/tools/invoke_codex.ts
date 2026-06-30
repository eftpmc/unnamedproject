import { spawn } from 'child_process';
import { appendOutput, requestApproval } from '../services/executor.js';
import { registerProcess, unregisterProcess } from '../lib/process-registry.js';
import { DELEGATE_FRAMING, DELEGATE_TIMEOUT_MS } from './agent_framing.js';
import { codexPermissionArgs, getDelegateEnv, normalizePermissionProfile, type PermissionProfile } from '../services/permissions.js';

interface CodexInput {
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
  repoPath?: string;
  resumeSessionId?: string | null;
  mcpServers?: Record<string, McpServerConfig>;
  permissionProfile?: PermissionProfile;
  effort?: string;
  /** System prompt to inject on first turn. Defaults to DELEGATE_FRAMING when absent. */
  systemPromptSuffix?: string;
  signal?: AbortSignal;
  onSessionId?: (id: string) => void;
  onText?: (delta: string) => void;
}

export interface CodexResult {
  result: string;
  sessionId: string | null;
  costUsd: number;
}

// Per-token pricing for known Codex CLI models (USD per 1M tokens).
// Prices reflect standard (non-cached) input rates.
const CODEX_MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'o3':              { inputPer1M: 10.00, outputPer1M: 40.00 },
  'o3-mini':         { inputPer1M:  1.10, outputPer1M:  4.40 },
  'o4-mini':         { inputPer1M:  1.10, outputPer1M:  4.40 },
  'codex-mini-latest': { inputPer1M: 1.10, outputPer1M:  4.40 },
};
const CODEX_DEFAULT_PRICING = { inputPer1M: 1.10, outputPer1M: 4.40 };

function estimateCodexCost(model: string | undefined, inputTokens: number, outputTokens: number): number {
  if (!inputTokens && !outputTokens) return 0;
  const pricing = model ? (CODEX_MODEL_PRICING[model] ?? CODEX_DEFAULT_PRICING) : CODEX_DEFAULT_PRICING;
  return (inputTokens / 1_000_000) * pricing.inputPer1M + (outputTokens / 1_000_000) * pricing.outputPer1M;
}

// codex exec has no --mcp-config flag (that's a Claude Code option) — MCP
// servers are passed as `-c mcp_servers.<name>.<field>=<toml value>` overrides.
function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlInlineTable(obj: Record<string, string>): string {
  const entries = Object.entries(obj).map(([k, v]) => `${tomlString(k)} = ${tomlString(v)}`);
  return `{ ${entries.join(', ')} }`;
}

function mcpServerConfigOverrides(servers: Record<string, McpServerConfig>): string[] {
  const overrides: string[] = [];
  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg.url) {
      // HTTP transport
      overrides.push(`-c`, `mcp_servers.${name}.url=${tomlString(cfg.url)}`);
      if (cfg.headers && Object.keys(cfg.headers).length > 0) {
        overrides.push(`-c`, `mcp_servers.${name}.http_headers=${tomlInlineTable(cfg.headers)}`);
      }
    } else if (cfg.command) {
      // stdio transport
      overrides.push(`-c`, `mcp_servers.${name}.command=${tomlString(cfg.command)}`);
      if (cfg.args && cfg.args.length > 0) {
        overrides.push(`-c`, `mcp_servers.${name}.args=${JSON.stringify(cfg.args)}`);
      }
      if (cfg.env && Object.keys(cfg.env).length > 0) {
        overrides.push(`-c`, `mcp_servers.${name}.env=${tomlInlineTable(cfg.env)}`);
      }
    }
  }
  return overrides;
}

export async function invokeCodex(input: CodexInput, ctx: ToolContext): Promise<CodexResult> {
  await requestApproval(ctx.executionId, ctx.userId, 'invoke_codex', { prompt: input.prompt }, 'agent');
  if (!ctx.repoPath) throw new Error('invoke_codex requires an explicit repoPath or scratch workspace');

  const profile = normalizePermissionProfile(ctx.permissionProfile);
  // codex exec [resume <sessionId>] --dangerously-bypass-approvals-and-sandbox --json [--skip-git-repo-check] "<prompt>"
  const args = ['exec'];
  if (ctx.resumeSessionId) {
    args.push('resume', ctx.resumeSessionId);
  }
  args.push(...codexPermissionArgs(profile), '--json');
  if (!ctx.resumeSessionId) args.push('--skip-git-repo-check');
  if (input.model) args.push('-m', input.model);
  if (ctx.effort) args.push('-c', `reasoning_effort=${tomlString(ctx.effort)}`);
  if (ctx.mcpServers && Object.keys(ctx.mcpServers).length > 0) {
    args.push(...mcpServerConfigOverrides(ctx.mcpServers));
  }
  // codex has no append-system-prompt equivalent — fold the framing into the prompt itself.
  const prompt = ctx.resumeSessionId ? input.prompt : `${ctx.systemPromptSuffix ?? DELEGATE_FRAMING}\n\n${input.prompt}`;
  args.push(prompt);

  return new Promise((resolve, reject) => {
    const proc = spawn('codex', args, {
      cwd: ctx.repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: getDelegateEnv('codex', profile),
    });

    registerProcess(ctx.executionId, proc);

    ctx.signal?.addEventListener('abort', () => {
      proc.kill('SIGTERM');
    }, { once: true });

    let buffer = '';
    let sessionId: string | null = null;
    let sessionIdFired = false;
    let resultText = '';
    let turnFailedMessage: string | null = null;
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

        if (event.type === 'thread.started') {
          const threadId = (event.thread_id as string) ?? sessionId;
          sessionId = threadId;
          if (!sessionIdFired && threadId && ctx.onSessionId) {
            sessionIdFired = true;
            ctx.onSessionId(threadId);
          }
        }
        if (event.type === 'item.completed') {
          const item = event.item as { type?: string; text?: string; call_id?: string; name?: string; output?: string } | undefined;
          if (item?.type === 'agent_message' && item.text) {
            resultText = item.text;
            appendOutput(ctx.executionId, ctx.userId, item.text + '\n');
            ctx.onText?.(item.text);
          } else if (item?.type === 'function_call' && item.name) {
            appendOutput(ctx.executionId, ctx.userId, `→ ${item.name}\n`);
          } else if (item?.type === 'local_shell_call' && item.output) {
            appendOutput(ctx.executionId, ctx.userId, `→ shell\n`);
          }
        }
        if (event.type === 'turn.completed') {
          const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined;
          if (usage) costUsd += estimateCodexCost(input.model, usage.input_tokens ?? 0, usage.output_tokens ?? 0);
        }
        if (event.type === 'turn.failed') {
          const err = event.error as { message?: string } | undefined;
          turnFailedMessage = err?.message ?? (event.message as string | undefined) ?? 'Codex turn failed';
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // Filter rmcp transport noise — non-fatal MCP connection warnings
      const filtered = text.split('\n').filter(l => !l.includes('rmcp::transport')).join('\n');
      if (filtered.trim()) stderrText += filtered;
      appendOutput(ctx.executionId, ctx.userId, text);
    });

    proc.on('error', err => {
      clearTimeout(timeoutTimer);
      unregisterProcess(ctx.executionId);
      reject(new Error(`Failed to launch codex: ${err.message}. Is the Codex CLI installed and on PATH?`));
    });

    proc.on('close', code => {
      clearTimeout(timeoutTimer);
      unregisterProcess(ctx.executionId);
      if (timedOut) {
        reject(new Error(`codex timed out after ${DELEGATE_TIMEOUT_MS / 1000}s and was killed`));
        return;
      }
      if (code === 0 || resultText) resolve({ result: resultText.trim() || 'Done.', sessionId, costUsd });
      else if (turnFailedMessage) reject(new Error(turnFailedMessage));
      else reject(new Error(`codex exited with code ${code}${stderrText.trim() ? `: ${stderrText.trim()}` : ''}`));
    });
  });
}
