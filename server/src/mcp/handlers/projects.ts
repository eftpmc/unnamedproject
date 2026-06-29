import { registerTool } from '../registry.js';
import { createProject, linkProject, listProjectsForUser, getProjectForUser } from '../../services/projects.js';

export function registerProjectHandlers(): void {
  registerTool({
    name: 'link_project',
    description: 'Register an existing git repo path as a project.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'ID of the project to add the repo to' },
        name: { type: 'string' },
        repo_path: { type: 'string' },
        default_branch: { type: 'string' },
      },
      required: ['project_id', 'name', 'repo_path'],
    },
    handler: async (args, userId) => {
      const project = getProjectForUser(args.project_id as string, userId);
      if (!project) return `Error: project ${args.project_id} not found`;
      return JSON.stringify(linkProject({
        space_id: project.space_id,
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
      const { listProjects } = await import('../../services/projects.js');
      return JSON.stringify(listProjects(project.space_id));
    },
  });
}
