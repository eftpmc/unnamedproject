import simpleGit from 'simple-git';
import { requestApproval, appendOutput } from '../services/executor.js';

interface GitOpInput {
  op: 'log' | 'diff' | 'status' | 'commit' | 'push';
  message?: string;
  branch?: string;
}

interface ToolContext {
  userId: string;
  executionId: string;
  projectId: string;
  repoPath: string;
}

const AGENT_OPS = new Set(['commit']);
const USER_OPS = new Set(['push']);

export async function runGitOp(input: GitOpInput, ctx: ToolContext): Promise<string> {
  const git = simpleGit(ctx.repoPath);

  if (AGENT_OPS.has(input.op)) {
    const decision = await requestApproval(ctx.executionId, ctx.userId, `git ${input.op}`, input as unknown as Record<string, unknown>, 'agent');
    if (decision === 'rejected') return `git ${input.op} cancelled`;
  }
  if (USER_OPS.has(input.op)) {
    const decision = await requestApproval(ctx.executionId, ctx.userId, `git ${input.op}`, input as unknown as Record<string, unknown>, 'user');
    if (decision === 'rejected') return `User rejected git ${input.op}`;
  }

  switch (input.op) {
    case 'log': {
      const log = await git.log({ maxCount: 20 });
      return log.all.map(c => `${c.hash.slice(0, 7)} ${c.message}`).join('\n');
    }
    case 'diff': {
      return await git.diff();
    }
    case 'status': {
      const s = await git.status();
      return JSON.stringify(s.files);
    }
    case 'commit': {
      if (!input.message) return 'Error: commit message required';
      await git.commit(input.message);
      return `committed: ${input.message}`;
    }
    case 'push': {
      await git.push();
      return 'pushed';
    }
    default:
      return 'Unknown git op';
  }
}
