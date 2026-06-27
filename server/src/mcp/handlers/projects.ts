import { registerTool } from '../registry.js';
import { createProject, linkProject, listProjects } from '../../services/projects.js';

export function registerProjectHandlers(): void {
  registerTool({
    name: 'create_project',
    description: 'Create a new git repo (project) inside a space. Returns the project_id and repo_path; code tools operate inside it.',
    inputSchema: {
      type: 'object',
      properties: { space_id: { type: 'string' }, name: { type: 'string' } },
      required: ['space_id', 'name'],
    },
    handler: async (args) => JSON.stringify(await createProject({ space_id: args.space_id as string, name: args.name as string })),
  });

  registerTool({
    name: 'link_project',
    description: 'Register an existing git repo path as a project in a space.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' }, name: { type: 'string' },
        repo_path: { type: 'string' }, default_branch: { type: 'string' },
      },
      required: ['space_id', 'name', 'repo_path'],
    },
    handler: async (args) => JSON.stringify(linkProject({
      space_id: args.space_id as string, name: args.name as string,
      repo_path: args.repo_path as string, default_branch: args.default_branch as string | undefined,
    })),
  });

  registerTool({
    name: 'list_projects',
    description: 'List the git repos (projects) in a space.',
    inputSchema: { type: 'object', properties: { space_id: { type: 'string' } }, required: ['space_id'] },
    handler: async (args) => JSON.stringify(listProjects(args.space_id as string)),
  });
}
