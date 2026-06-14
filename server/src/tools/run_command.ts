import { exec } from 'child_process';
import { promisify } from 'util';
import { getProjectForUser, getDataDir } from '../db/index.js';
import { requestApproval } from '../services/executor.js';
import type { PermissionProfile } from '../services/permissions.js';

const execAsync = promisify(exec);

const MAX_OUTPUT_BYTES = 10 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;

interface RunCommandInput {
  command: string;
  project_id?: string;
  timeout_ms?: number;
  campaign_task_id?: string;
}

interface ToolContext {
  userId: string;
  executionId: string;
  permissionProfile: PermissionProfile;
}

export async function runCommand(input: RunCommandInput, ctx: ToolContext): Promise<string> {
  let cwd: string = getDataDir();
  if (input.project_id) {
    const project = getProjectForUser(input.project_id, ctx.userId);
    if (!project) return `Error: project ${input.project_id} not found`;
    if (project.repo_path) cwd = project.repo_path;
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
    const { stdout, stderr } = await execAsync(input.command, { cwd, timeout });
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
