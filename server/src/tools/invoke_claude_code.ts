import { spawn } from 'child_process';
import { appendOutput, requestApproval } from '../services/executor.js';

interface ClaudeCodeInput {
  prompt: string;
}

interface ToolContext {
  userId: string;
  executionId: string;
  repoPath: string;
  apiKey: string | null;
  resumeSessionId?: string | null;
}

export interface ClaudeCodeResult {
  result: string;
  sessionId: string | null;
}

export async function invokeClaudeCode(input: ClaudeCodeInput, ctx: ToolContext): Promise<ClaudeCodeResult> {
  await requestApproval(ctx.executionId, ctx.userId, 'invoke_claude_code', { prompt: input.prompt }, 'agent');

  const args = ['--print', '--permission-mode', 'bypassPermissions', '--output-format', 'json'];
  if (ctx.resumeSessionId) args.push('--resume', ctx.resumeSessionId);
  args.push(input.prompt);

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      cwd: ctx.repoPath,
      env: ctx.apiKey ? { ...process.env, ANTHROPIC_API_KEY: ctx.apiKey } : process.env,
    });

    let output = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      appendOutput(ctx.executionId, ctx.userId, chunk.toString());
    });
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${output.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(output);
        const text = typeof parsed.result === 'string' ? parsed.result : output.trim();
        appendOutput(ctx.executionId, ctx.userId, text);
        resolve({ result: text, sessionId: parsed.session_id ?? null });
      } catch {
        appendOutput(ctx.executionId, ctx.userId, output);
        resolve({ result: output.trim(), sessionId: null });
      }
    });
  });
}
