import { registerTool } from '../registry.js';
import { linkProject, getProjectForUser } from '../../services/projects.js';

export function registerProjectHandlers(): void {
  registerTool({
    name: 'link_project',
    description: 'Register an existing git repo path as a project.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        repo_path: { type: 'string' },
        default_branch: { type: 'string' },
      },
      required: ['name', 'repo_path'],
    },
    handler: async (args, userId) => {
      return JSON.stringify(linkProject({
        user_id: userId,
        name: args.name as string,
        repo_path: args.repo_path as string,
        default_branch: args.default_branch as string | undefined,
      }));
    },
  });

  registerTool({
    name: 'list_git_repos',
    description: 'List the git repos inside a project.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'] },
    handler: async (args, userId) => {
      const project = getProjectForUser(args.project_id as string, userId);
      if (!project) return `Error: project ${args.project_id} not found`;
      return JSON.stringify([project]);
    },
  });
}
