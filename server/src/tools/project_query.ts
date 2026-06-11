import { spawn } from 'child_process';
import { getProjectForUser } from '../db/index.js';
import { getAnthropicKey } from '../services/anthropic.js';
import { ensureWorktree } from '../lib/worktree.js';

interface ProjectQueryInput {
  project_id: string;
  question: string;
  session_id: string;
}

export async function runProjectQuery(input: ProjectQueryInput, userId: string): Promise<string> {
  const project = getProjectForUser(input.project_id, userId);

  if (!project?.repo_path) {
    return 'Project has no repo path configured.';
  }

  const apiKey = getAnthropicKey(userId);
  const workspace = await ensureWorktree(project, input.session_id);

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--print', '--permission-mode', 'plan', '--output-format', 'json', input.question], {
      cwd: workspace.worktree_path,
      env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
    });

    let output = '';
    proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`project_query exited with code ${code}: ${output.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(output);
        resolve(typeof parsed.result === 'string' ? parsed.result : output.trim());
      } catch {
        resolve(output.trim());
      }
    });
  });
}
