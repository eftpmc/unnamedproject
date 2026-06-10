import { spawn } from 'child_process';
import { appendOutput, requestApproval } from '../services/executor.js';

interface ClaudeCodeInput {
  prompt: string;
}

interface ToolContext {
  userId: string;
  executionId: string;
  repoPath: string;
  apiKey: string;
}

export async function invokeClaudeCode(input: ClaudeCodeInput, ctx: ToolContext): Promise<string> {
  await requestApproval(ctx.executionId, ctx.userId, 'invoke_claude_code', { prompt: input.prompt }, 'agent');
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--print', input.prompt], {
      cwd: ctx.repoPath,
      env: { ...process.env, ANTHROPIC_API_KEY: ctx.apiKey },
    });

    let output = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      appendOutput(ctx.executionId, ctx.userId, text);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      appendOutput(ctx.executionId, ctx.userId, chunk.toString());
    });
    proc.on('close', code => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`claude exited with code ${code}`));
    });
  });
}
