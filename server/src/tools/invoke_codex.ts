import { spawn } from 'child_process';
import { appendOutput, requestApproval } from '../services/executor.js';
import { registerProcess, unregisterProcess } from '../lib/process-registry.js';
import { DELEGATE_FRAMING, DELEGATE_TIMEOUT_MS } from './agent_framing.js';
import { codexPermissionArgs, getDelegateEnv, normalizePermissionProfile, type PermissionProfile } from '../services/permissions.js';

interface CodexInput {
  prompt: string;
  model?: string;
}

interface McpServerConfig { command: string; args?: string[]; env?: Record<string, string> }

interface ToolContext {
  userId: string;
  executionId: string;
  repoPath: string;
  apiKey: string | null;
  resumeSessionId?: string | null;
  mcpServers?: Record<string, McpServerConfig>;
  permissionProfile?: PermissionProfile;
}

export interface CodexResult {
  result: string;
  sessionId: string | null;
  costUsd: number;
}

// Approximate $/1M token rates, used only to estimate spend for the usage budget display.
// Update if OpenAI changes pricing or codex's default model.
const CODEX_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5-codex': { input: 1.25, output: 10 },
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
};
const DEFAULT_CODEX_PRICING = CODEX_PRICING['gpt-5-codex'];

function estimateCodexCost(model: string | undefined, inputTokens: number, outputTokens: number): number {
  const pricing = (model ? CODEX_PRICING[model] : undefined) ?? DEFAULT_CODEX_PRICING;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
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
    overrides.push(`-c`, `mcp_servers.${name}.command=${tomlString(cfg.command)}`);
    if (cfg.args && cfg.args.length > 0) {
      overrides.push(`-c`, `mcp_servers.${name}.args=${JSON.stringify(cfg.args)}`);
    }
    if (cfg.env && Object.keys(cfg.env).length > 0) {
      overrides.push(`-c`, `mcp_servers.${name}.env=${tomlInlineTable(cfg.env)}`);
    }
  }
  return overrides;
}

export async function invokeCodex(input: CodexInput, ctx: ToolContext): Promise<CodexResult> {
  await requestApproval(ctx.executionId, ctx.userId, 'invoke_codex', { prompt: input.prompt }, 'agent');

  const profile = normalizePermissionProfile(ctx.permissionProfile);
  // codex exec [resume <sessionId>] --dangerously-bypass-approvals-and-sandbox --json [--skip-git-repo-check] "<prompt>"
  const args = ['exec'];
  if (ctx.resumeSessionId) {
    args.push('resume', ctx.resumeSessionId);
  }
  args.push(...codexPermissionArgs(profile), '--json');
  if (!ctx.resumeSessionId) args.push('--skip-git-repo-check');
  if (input.model) args.push('-m', input.model);
  if (ctx.mcpServers && Object.keys(ctx.mcpServers).length > 0) {
    args.push(...mcpServerConfigOverrides(ctx.mcpServers));
  }
  // codex has no append-system-prompt equivalent — fold the framing into the prompt itself.
  const prompt = ctx.resumeSessionId ? input.prompt : `${DELEGATE_FRAMING}\n\n${input.prompt}`;
  args.push(prompt);

  return new Promise((resolve, reject) => {
    const proc = spawn('codex', args, {
      cwd: ctx.repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: getDelegateEnv('codex', ctx.apiKey, profile),
    });

    registerProcess(ctx.executionId, proc);

    let buffer = '';
    let sessionId: string | null = null;
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

        if (event.type === 'thread.started') sessionId = (event.thread_id as string) ?? sessionId;
        if (event.type === 'item.completed') {
          const item = event.item as { type?: string; text?: string } | undefined;
          if (item?.type === 'agent_message' && item.text) {
            resultText = item.text;
            appendOutput(ctx.executionId, ctx.userId, item.text + '\n');
          }
        }
        if (event.type === 'turn.completed') {
          const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined;
          if (usage) costUsd += estimateCodexCost(input.model, usage.input_tokens ?? 0, usage.output_tokens ?? 0);
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
      reject(new Error(`Failed to launch codex: ${err.message}. Is the Codex CLI installed and on PATH?`));
    });

    proc.on('close', code => {
      clearTimeout(timeoutTimer);
      unregisterProcess(ctx.executionId);
      if (timedOut) {
        reject(new Error(`codex timed out after ${DELEGATE_TIMEOUT_MS / 1000}s and was killed`));
        return;
      }
      if (code === 0) resolve({ result: resultText.trim() || 'Done.', sessionId, costUsd });
      else reject(new Error(`codex exited with code ${code}${stderrText.trim() ? `: ${stderrText.trim()}` : ''}`));
    });
  });
}
