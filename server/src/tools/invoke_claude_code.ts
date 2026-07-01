import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import simpleGit from 'simple-git';
import { appendOutput, requestApproval } from '../services/executor.js';
import { registerProcess, unregisterProcess } from '../lib/process-registry.js';
import { DELEGATE_FRAMING, DELEGATE_TIMEOUT_MS } from './agent_framing.js';
import {
  allowsSelfModification,
  allowsToolBuilding,
  claudePermissionArgs,
  canonicalPermissionProfile,
  getDelegateEnv,
  normalizePermissionProfile,
  shouldUseIsolatedRuntime,
  type PermissionProfile,
} from '../services/permissions.js';
import { APP_ROOT } from '../lib/workspacePaths.js';
import { generateMcpToken } from '../mcp/auth.js';

interface ClaudeCodeInput {
  prompt: string;
  model?: string;
}

export interface McpServerConfig {
  // stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
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
  allowedDirs?: string[];
  permissionProfile?: PermissionProfile;
  apiKey?: string;
  effort?: string;
  /** System prompt to inject on first turn. Defaults to DELEGATE_FRAMING when absent. */
  systemPromptSuffix?: string;
  /** Override the default 30-minute kill timeout. */
  timeoutMs?: number;
  signal?: AbortSignal;
  onText?: (delta: string) => void;      // for streaming chat
  onSessionId?: (id: string) => void;
}

export interface ClaudeCodeResult {
  result: string;
  sessionId: string | null;
  costUsd: number;
}

interface AppRepoSnapshot {
  head: string | null;
  status: string;
}

async function snapshotAppRepo(): Promise<AppRepoSnapshot | null> {
  const git = simpleGit(APP_ROOT);
  try {
    const head = (await git.raw(['rev-parse', 'HEAD'])).trim() || null;
    const status = await git.raw([
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      '.',
      ':(exclude).claude',
      ':(exclude).playwright-cli',
    ]);
    return { head, status };
  } catch {
    return null;
  }
}

async function assertAppRepoUnchanged(before: AppRepoSnapshot | null): Promise<void> {
  if (!before) return;
  const after = await snapshotAppRepo();
  if (!after) return;
  if (after.head === before.head && after.status === before.status) return;

  const details = [
    after.head !== before.head ? `HEAD changed from ${before.head ?? 'unknown'} to ${after.head ?? 'unknown'}` : null,
    after.status !== before.status ? 'working tree status changed' : null,
  ].filter(Boolean).join('; ');
  throw new Error(`Blocked delegate boundary violation: the Unnamed app repository was modified without the self-modification profile (${details}).`);
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

function defaultAllowedTools(mcpServers: Record<string, McpServerConfig> | undefined, profile: PermissionProfile): string[] {
  const tools = [
    'Read',
    'WebFetch',
    'WebSearch',
    'Bash(ls *)',
    'Bash(find *)',
  ];
  const canonical = canonicalPermissionProfile(profile);
  if (canonical !== 'chat_only') {
    tools.push('Bash(cat *)');
  }
  // Pre-approve all tools from every connected MCP server via wildcard.
  // The app server enforces profile-based access control server-side,
  // so the wildcard here doesn't bypass tool_builder gating.
  for (const name of Object.keys(mcpServers ?? {})) {
    tools.push(`mcp__${name}__*`);
  }
  return tools;
}

function uniqueResolvedDirs(dirs: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of dirs) {
    if (!dir) continue;
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

export async function invokeClaudeCode(input: ClaudeCodeInput, ctx: ToolContext): Promise<ClaudeCodeResult> {
  await requestApproval(ctx.executionId, ctx.userId, 'invoke_claude_code', { prompt: input.prompt }, 'agent');
  if (!ctx.repoPath) throw new Error('invoke_claude_code requires an explicit repoPath or scratch workspace');

  const profile = normalizePermissionProfile(ctx.permissionProfile);
  const canSelfModify = allowsSelfModification(profile);
  const appRepoBeforePromise = canSelfModify ? Promise.resolve(null) : snapshotAppRepo();
  const args = ['--print', ...claudePermissionArgs(profile), '--output-format', 'stream-json', '--verbose'];
  const allowedTools = defaultAllowedTools(ctx.mcpServers, profile);
  if (allowedTools.length > 0) args.push('--allowedTools', allowedTools.join(','));
  const allowedDirs = uniqueResolvedDirs([...(ctx.allowedDirs ?? [])]);
  if (allowedDirs.length > 0) args.push('--add-dir', ...allowedDirs);
  let mcpConfigDir: string | null = null;
  let runtimeHomeDir: string | undefined;
  let runtimeTmpDir: string | undefined;
  if (shouldUseIsolatedRuntime(profile)) {
    const runtimeDir = path.join(ctx.repoPath, '.unnamed', 'delegate-runtime');
    runtimeHomeDir = path.join(runtimeDir, 'home');
    runtimeTmpDir = path.join(runtimeDir, 'tmp');
    await fs.mkdir(path.join(runtimeHomeDir, '.config'), { recursive: true });
    await fs.mkdir(path.join(runtimeHomeDir, '.cache'), { recursive: true });
    await fs.mkdir(path.join(runtimeHomeDir, '.local', 'share'), { recursive: true });
    await fs.mkdir(runtimeTmpDir, { recursive: true });
  }
  if (input.model) args.push('--model', input.model);
  if (!ctx.resumeSessionId) args.push('--append-system-prompt', ctx.systemPromptSuffix ?? DELEGATE_FRAMING);
  if (ctx.resumeSessionId) args.push('--resume', ctx.resumeSessionId);
  if (ctx.mcpServers && Object.keys(ctx.mcpServers).length > 0) {
    mcpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unnamed-claude-mcp-'));
    const mcpConfigPath = path.join(mcpConfigDir, 'mcp.json');
    const servers: Record<string, unknown> = {};
    for (const [name, cfg] of Object.entries(ctx.mcpServers)) {
      if (cfg.url) {
        let headers = cfg.headers;
        if (name === 'app') {
          const delegateToken = generateMcpToken(ctx.userId, null, profile);
          headers = { ...headers, Authorization: `Bearer ${delegateToken}` };
        }
        servers[name] = { type: 'http', url: cfg.url, ...(headers ? { headers } : {}) };
      } else {
        servers[name] = { command: cfg.command, args: cfg.args ?? [], env: cfg.env ?? {}, ...(cfg.cwd ? { cwd: cfg.cwd } : {}) };
      }
    }
    await fs.writeFile(mcpConfigPath, JSON.stringify({ mcpServers: servers }));
    args.push('--mcp-config', mcpConfigPath);
  }
  args.push('--');
  args.push(input.prompt);

  return new Promise((resolve, reject) => {
    const spawnEnv = getDelegateEnv('claude_code', profile, { homeDir: runtimeHomeDir, tmpDir: runtimeTmpDir, apiKey: ctx.apiKey });
    if (ctx.effort) spawnEnv.CLAUDE_EFFORT = ctx.effort;
    if (!canSelfModify) {
      const existingCeilings = spawnEnv.GIT_CEILING_DIRECTORIES ? spawnEnv.GIT_CEILING_DIRECTORIES.split(path.delimiter) : [];
      spawnEnv.GIT_CEILING_DIRECTORIES = [path.resolve(ctx.repoPath!), ...existingCeilings].join(path.delimiter);
    }
    const proc = spawn('claude', args, {
      cwd: ctx.repoPath,
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
    let emittedText = false;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (proc.exitCode === null) proc.kill('SIGKILL');
      }, 5000);
    }, ctx.timeoutMs ?? DELEGATE_TIMEOUT_MS);

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
          let firstText = true;
          for (const block of msg?.content ?? []) {
            if (block.type === 'tool_use' && block.name) {
              appendOutput(ctx.executionId, ctx.userId, `→ ${summarizeToolUse(block.name, block.input ?? {})}\n`);
            }
            if (block.type === 'text' && block.text) {
              const prefix = (emittedText && firstText) ? '\n\n' : '';
              appendOutput(ctx.executionId, ctx.userId, prefix + block.text);
              ctx.onText?.(prefix + block.text);
              firstText = false;
              emittedText = true;
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

    proc.on('close', async code => {
      clearTimeout(timeoutTimer);
      unregisterProcess(ctx.executionId);
      if (mcpConfigDir) void fs.rm(mcpConfigDir, { recursive: true, force: true });
      try {
        const appRepoBefore = await appRepoBeforePromise;
        if (!canSelfModify) await assertAppRepoUnchanged(appRepoBefore);
        if (timedOut) {
          reject(new Error(`claude timed out after ${(ctx.timeoutMs ?? DELEGATE_TIMEOUT_MS) / 1000}s and was killed`));
          return;
        }
        if (code !== 0 && !resultText) {
          reject(new Error(`claude exited with code ${code}${stderrText.trim() ? `: ${stderrText.trim()}` : ''}`));
          return;
        }
        resolve({ result: resultText || 'Done.', sessionId, costUsd });
      } catch (err) {
        reject(err);
      }
    });
  });
}
