import { registerTool } from '../registry.js';
import { runGitOp } from '../../tools/git_op.js';
import { getProject } from '../../services/projects.js';
import { ensureWorktree } from '../../lib/worktree.js';
import { createExecution, completeExecution } from '../../services/executor.js';
import { newId } from '../../lib/ids.js';

export function registerGitHandlers(): void {
  registerTool({
    name: 'git_op',
    description: 'Run a git operation (log, diff, status, commit, push) on a repo project',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string' },
        op: { type: 'string', enum: ['log', 'diff', 'status', 'add', 'commit', 'push'] },
        message: { type: 'string' },
        branch: { type: 'string' },
      },
      required: ['space_id', 'item_id', 'op'],
    },
    handler: async (args, userId, sessionId) => {
      const project = getProject(args.item_id as string);
      if (!project || project.space_id !== args.space_id) {
        return `Error: repo project ${args.item_id} not found in space ${args.space_id}`;
      }
      const repoItem = { id: project.id, fields: { repo_path: project.repo_path } };
      const executionId = createExecution(userId, null, args.space_id as string, 'git_op');
      const worktree = await ensureWorktree(repoItem, sessionId ?? newId());
      const result = await runGitOp(
        {
          op: args.op as 'log' | 'diff' | 'status' | 'commit' | 'push',
          message: args.message as string | undefined,
          branch: (args.branch as string | undefined) ?? worktree.branch,
        },
        { userId, executionId, projectId: args.space_id as string, repoPath: worktree.worktree_path },
      );
      completeExecution(executionId, userId, result.startsWith('Error:') ? 'error' : 'done', result);
      return result;
    },
  });
}
