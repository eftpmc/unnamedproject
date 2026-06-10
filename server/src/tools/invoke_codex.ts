import { spawn } from 'child_process';
import { appendOutput } from '../services/executor.js';

interface CodexInput {
  prompt: string;
}

interface ToolContext {
  userId: string;
  executionId: string;
  repoPath: string;
  apiKey: string;
}

export function invokeCodex(input: CodexInput, ctx: ToolContext): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('codex', ['--quiet', input.prompt], {
      cwd: ctx.repoPath,
      env: { ...process.env, OPENAI_API_KEY: ctx.apiKey },
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
      else reject(new Error(`codex exited with code ${code}`));
    });
  });
}
