import { registerTool } from '../registry.js';
import { getDb, createSessionEvent } from '../../db/index.js';
import { broadcast } from '../../services/socket.js';
import { listProjectsForUser, getProjectForUser, createProject } from '../../services/projects.js';

export function registerSpaceHandlers(): void {
  registerTool({
    name: 'list_projects',
    description: 'List all projects for the user',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => {
      const projects = listProjectsForUser(userId);
      return JSON.stringify(projects.map(p => ({ id: p.id, name: p.name, description: p.description })));
    },
  });

  registerTool({
    name: 'create_project',
    description: 'Create a new project workspace',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['name'],
    },
    handler: async (args, userId) => {
      const project = await createProject({ name: args.name as string, user_id: userId });
      if (args.description) {
        getDb().prepare('UPDATE projects SET description = ? WHERE id = ?').run(args.description as string, project.id);
      }
      const result = getDb()
        .prepare('SELECT id, name, description FROM projects WHERE id = ?')
        .get(project.id) as { id: string; name: string; description: string | null } | undefined;
      return result ? JSON.stringify(result) : 'Error: failed to create project';
    },
  });

  registerTool({
    name: 'update_project',
    description: 'Update a project name or description',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['project_id'],
    },
    handler: async (args, userId) => {
      const project = getProjectForUser(args.project_id as string, userId);
      if (!project) return `Error: project ${args.project_id} not found`;
      const fields: string[] = [];
      const values: unknown[] = [];
      if (args.name !== undefined) { fields.push('name = ?'); values.push(args.name); }
      if (args.description !== undefined) { fields.push('description = ?'); values.push(args.description); }
      if (fields.length > 0) {
        getDb().prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values, project.id);
      }
      return `Project '${(args.name as string | undefined) ?? project.name}' updated`;
    },
  });

  registerTool({
    name: 'pin_project',
    description: 'Pin a project to the current session so it becomes the active context for this chat. Pass null to unpin.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project to pin, or null to unpin' },
      },
    },
    handler: async (args, userId, sessionId) => {
      if (!sessionId) return 'Error: no session context';
      const projectId = (args.project_id as string | null | undefined) ?? null;
      getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);

      const project = projectId
        ? getDb().prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId) as { id: string; name: string } | undefined
        : null;
      const title = project ? `Pinned to ${project.name}` : 'Project unpinned';
      const event = createSessionEvent({
        sessionId,
        type: 'scope_changed',
        title,
        projectId: project?.id ?? null,
        metadata: { source: 'agent' },
      });
      broadcast(userId, {
        type: 'session_event_created',
        sessionId,
        event: { ...event, metadata: JSON.parse(event.metadata || '{}') },
      });

      return project ? `Pinned project ${project.id} (${project.name}) to this session` : 'Unpinned project from this session';
    },
  });

  registerTool({
    name: 'delete_project',
    description: 'Delete a project and optionally its files',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        delete_files: { type: 'boolean' },
      },
      required: ['project_id'],
    },
    handler: async (args, userId) => {
      const { deleteProject: deleteProjectTool } = await import('../../tools/project_ops.js');
      return deleteProjectTool(
        { project_id: args.project_id as string, delete_files: (args.delete_files as boolean | undefined) ?? false },
        userId,
        'mcp',
      );
    },
  });

  // Legacy aliases so any cached prompts using old tool names still work
  registerTool({
    name: 'list_spaces',
    description: 'Deprecated alias for list_projects',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => {
      const projects = listProjectsForUser(userId);
      return JSON.stringify(projects.map(p => ({ id: p.id, name: p.name, description: p.description })));
    },
  });

  registerTool({
    name: 'pin_space',
    description: 'Deprecated alias for pin_project',
    inputSchema: { type: 'object', properties: { space_id: { type: 'string' } } },
    handler: async (args, _userId, sessionId) => {
      if (!sessionId) return 'Error: no session context';
      const projectId = (args.space_id as string | null | undefined) ?? null;
      getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);
      return projectId ? `Pinned project ${projectId}` : 'Unpinned project';
    },
  });

  registerTool({
    name: 'create_space',
    description: 'Deprecated alias for create_project',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    handler: async (args, userId) => {
      const project = await createProject({ name: args.name as string, user_id: userId });
      return JSON.stringify({ id: project.id, name: project.name });
    },
  });
}
