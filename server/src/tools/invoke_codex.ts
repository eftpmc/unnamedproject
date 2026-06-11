import { spawn } from 'child_process';
import { appendOutput, requestApproval } from '../services/executor.js';
import { registerProcess, unregisterProcess } from '../lib/process-registry.js';

interface CodexInput {
  prompt: string;
}

interface McpServerConfig { command: string; args?: string[]; env?: Record<string, string> }

interface ToolContext {
  userId: string;
  executionId: string;
  repoPath: string;
  apiKey: string | null;
  resumeSessionId?: string | null;
  mcpServers?: Record<string, McpServerConfig>;
}

export interface CodexResult {
  result: string;
  sessionId: string | null;
}

export async function invokeCodex(input: CodexInput, ctx: ToolContext): Promise<CodexResult> {
  await requestApproval(ctx.executionId, ctx.userId, 'invoke_codex', { prompt: input.prompt }, 'agent');

  // codex exec [resume <sessionId>] --dangerously-bypass-approvals-and-sandbox --json [--skip-git-repo-check] "<prompt>"
  const args = ['exec'];
  if (ctx.resumeSessionId) {
    args.push('resume', ctx.resumeSessionId);
  }
  args.push('--dangerously-bypass-approvals-and-sandbox', '--json');
  if (!ctx.resumeSessionId) args.push('--skip-git-repo-check');
  if (ctx.mcpServers && Object.keys(ctx.mcpServers).length > 0) {
    args.push('--mcp-config', JSON.stringify({ mcpServers: ctx.mcpServers }));
  }
  args.push(input.prompt);

  return new Promise((resolve, reject) => {
    const proc = spawn('codex', args, {
      cwd: ctx.repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: ctx.apiKey ? { ...process.env, OPENAI_API_KEY: ctx.apiKey } : process.env,
    });

    registerProcess(ctx.executionId, proc);

    let buffer = '';
    let sessionId: string | null = null;
    let resultText = '';

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
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      appendOutput(ctx.executionId, ctx.userId, chunk.toString());
    });

    proc.on('close', code => {
      unregisterProcess(ctx.executionId);
      if (code === 0) resolve({ result: resultText.trim() || 'Done.', sessionId });
      else reject(new Error(`codex exited with code ${code}`));
    });
  });
}
