import { registerTool } from '../registry.js';
import { listProjects, createProject, updateProject, deleteProject } from '../../tools/project_ops.js';
import { getDb, createSessionEvent } from '../../db/index.js';
import { broadcast } from '../../services/socket.js';

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
      await createProject({ name: args.name as string, description: args.description as string | undefined, with_repo: false }, userId, 'mcp');
      const space = getDb()
        .prepare('SELECT id, name, description FROM spaces WHERE user_id = ? AND name = ? ORDER BY created_at DESC LIMIT 1')
        .get(userId, args.name as string) as { id: string; name: string; description: string | null } | undefined;
      if (!space) return 'Error: failed to create space';
      return JSON.stringify(space);
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
    name: 'pin_space',
    description: 'Pin a space to the current session so it becomes the active context for this chat. Call this after creating or identifying the space the user wants to work in — it persists across turns. Pass null to unpin.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Space to pin, or null to unpin' },
      },
    },
    handler: async (args, userId, sessionId) => {
      if (!sessionId) return 'Error: no session context';
      const spaceId = (args.space_id as string | null | undefined) ?? null;
      getDb().prepare('UPDATE sessions SET pinned_space_id = ? WHERE id = ?').run(spaceId, sessionId);

      const space = spaceId
        ? getDb().prepare('SELECT id, name FROM spaces WHERE id = ?').get(spaceId) as { id: string; name: string } | undefined
        : null;
      const title = space ? `Pinned to ${space.name}` : 'Space unpinned';
      const event = createSessionEvent({
        sessionId,
        type: 'scope_changed',
        title,
        spaceId: space?.id ?? null,
        metadata: { source: 'agent' },
      });
      broadcast(userId, {
        type: 'session_event_created',
        sessionId,
        event: { ...event, metadata: JSON.parse(event.metadata || '{}') },
      });

      return space ? `Pinned space ${space.id} (${space.name}) to this session` : 'Unpinned space from this session';
    },
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
