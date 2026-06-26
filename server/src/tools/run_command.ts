import { exec } from 'child_process';
import { promisify } from 'util';
import { getSpaceForUser, getDataDir } from '../db/index.js';
import { getItemById } from '../services/items.js';
import { requestApproval } from '../services/executor.js';
import { getDelegateEnv } from '../services/permissions.js';
import type { PermissionProfile } from '../services/permissions.js';

const execAsync = promisify(exec);

const MAX_OUTPUT_BYTES = 10 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;

// Patterns that are blocked unconditionally regardless of permission profile.
// These target the specific risk of prompt injection: a manipulated LLM passing
// a destructive or exfiltrating command that would otherwise be auto-approved.
const BLOCKED_PATTERNS: RegExp[] = [
  // Recursive deletion with short flags in any order (rm -r -f /path, rm -rf /path, etc.)
  /\brm\b(?:\s+-[A-Za-z]*)*\s+-[A-Za-z]*[rR][A-Za-z]*(?:\s+-[A-Za-z]*)*\s+(\/(?!tmp|var\/folders)[^\s]*|~|\$\{?HOME\}?)/,
  // Recursive deletion with GNU long flag (rm --recursive ...)
  /\brm\b.*--recursive\b.*?(\/(?!tmp|var\/folders)[^\s]*|~|\$\{?HOME\}?)/s,
  // Piping content directly to a shell interpreter (| bash, | /usr/bin/bash, etc.)
  /\|\s*(\S*\/)?(bash|sh|zsh|python3?|ruby|node|perl)\b/i,
  // Subshell execution of downloaded content: $(curl ...) or `curl ...`
  /(\$\(|`).*\bcurl\b/i,
  /wget\s.*-O\s*-/i,
  // Reading private credential files (cat, head, tail, less, base64, xxd, etc.)
  /(cat|head|tail|less|more|strings|xxd|base64|od)\s+.*\/(\.ssh\/(id_[^\s]*|known_hosts|authorized_keys)|\.aws\/credentials|\.gnupg|\.netrc)\b/i,
  // Exfiltrating environment variables to a network address
  /\b(env|printenv|export)\b.*\|\s*curl/i,
  // Fork bomb
  /:\s*\(\s*\)\s*\{.*:\|:/,
];

export function isBlocked(command: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) return `Command blocked by security policy: matches pattern ${pattern.source.slice(0, 60)}`;
  }
  return null;
}

interface RunCommandInput {
  command: string;
  space_id?: string;
  item_id?: string;
  timeout_ms?: number;
  plan_step_id?: string;
}

interface ToolContext {
  userId: string;
  executionId: string;
  permissionProfile: PermissionProfile;
}

export async function runCommand(input: RunCommandInput, ctx: ToolContext): Promise<string> {
  const blocked = isBlocked(input.command);
  if (blocked) return `Error: ${blocked}`;

  let cwd: string = getDataDir();
  if (input.space_id || input.item_id) {
    if (!input.space_id || !input.item_id) return 'Error: space_id and item_id must be provided together';
    const space = getSpaceForUser(input.space_id, ctx.userId);
    if (!space) return `Error: space ${input.space_id} not found`;
    const repoItem = getItemById(input.item_id);
    if (!repoItem || repoItem.space_id !== space.id) return `Error: item ${input.item_id} not found in space ${space.id}`;
    if (repoItem.type !== 'repo') return `Error: item ${input.item_id} is not a repo`;
    cwd = repoItem.fields.repo_path as string;
  }

  const tier = ctx.permissionProfile === 'strict' ? 'user' : 'agent';
  const decision = await requestApproval(
    ctx.executionId,
    ctx.userId,
    'run_command',
    { command: input.command, cwd },
    tier,
  );
  if (decision === 'rejected') return 'run_command cancelled';

  const timeout = Math.min(input.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  try {
    const { stdout, stderr } = await execAsync(input.command, { cwd, timeout, env: getDelegateEnv('claude_code', ctx.permissionProfile) });
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    const buf = Buffer.from(combined, 'utf8');
    if (buf.length > MAX_OUTPUT_BYTES) {
      return buf.subarray(0, MAX_OUTPUT_BYTES).toString('utf8') + `\n…(truncated — ${buf.length} bytes total)`;
    }
    return combined || '(no output)';
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    if (e.killed) return `Error: command timed out after ${timeout}ms`;
    const output = [e.stdout, e.stderr].filter(Boolean).join('\n');
    return `Error: ${e.message ?? 'command failed'}\n${output}`.trim();
  }
}
