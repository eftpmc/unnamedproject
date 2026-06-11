import { spawn } from 'child_process';
import { appendOutput, requestApproval } from '../services/executor.js';

interface CodexInput {
  prompt: string;
}

interface ToolContext {
  userId: string;
  executionId: string;
  repoPath: string;
  apiKey: string;
  resumeSessionId?: string | null;
}

export interface CodexResult {
  result: string;
  sessionId: string | null;
}

export async function invokeCodex(input: CodexInput, ctx: ToolContext): Promise<CodexResult> {
  await requestApproval(ctx.executionId, ctx.userId, 'invoke_codex', { prompt: input.prompt }, 'agent');

  const args = ['exec'];
  if (ctx.resumeSessionId) {
    args.push('resume', ctx.resumeSessionId, '-c', 'sandbox_mode="workspace-write"', '--json', input.prompt);
  } else {
    args.push('-c', 'sandbox_mode="workspace-write"', '--json', '--skip-git-repo-check', input.prompt);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('codex', args, {
      cwd: ctx.repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OPENAI_API_KEY: ctx.apiKey },
    });

    let buffer = '';
    let sessionId: string | null = null;
    let resultText = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        let event: any;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'thread.started') sessionId = event.thread_id ?? sessionId;
        if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
          resultText = event.item.text ?? resultText;
          appendOutput(ctx.executionId, ctx.userId, event.item.text + '\n');
        }
      }
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      appendOutput(ctx.executionId, ctx.userId, chunk.toString());
    });
    proc.on('close', code => {
      if (code === 0) resolve({ result: resultText.trim(), sessionId });
      else reject(new Error(`codex exited with code ${code}`));
    });
  });
}
