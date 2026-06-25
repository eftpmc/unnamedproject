import { registerTool } from '../registry.js';
import { listProjects, updateProject, deleteProject } from '../../tools/project_ops.js';
import { getDb } from '../../db/index.js';
import { newId } from '../../lib/ids.js';

export function registerSpaceHandlers(): void {
  registerTool({
    name: 'list_spaces',
    description: 'List all spaces for the user',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => listProjects(userId),
  });

  registerTool({
    name: 'create_space',
    description: 'Create a new space',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['name'],
    },
    handler: async (args, userId) => {
      const id = newId();
      const name = args.name as string;
      const description = (args.description as string | undefined) ?? null;
      getDb()
        .prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
        .run(id, userId, name, description, '[]');
      return JSON.stringify({ id, name, description });
    },
  });

  registerTool({
    name: 'update_space',
    description: 'Update an existing space name or description',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['space_id'],
    },
    handler: async (args, userId) =>
      updateProject(
        {
          space_id: args.space_id as string,
          name: args.name as string | undefined,
          description: args.description as string | undefined,
        },
        userId,
      ),
  });

  registerTool({
    name: 'delete_space',
    description: 'Delete a space and optionally its files',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        delete_files: { type: 'boolean' },
      },
      required: ['space_id'],
    },
    handler: async (args, userId) =>
      deleteProject(
        {
          space_id: args.space_id as string,
          delete_files: (args.delete_files as boolean | undefined) ?? false,
        },
        userId,
        'mcp',
      ),
  });
}
