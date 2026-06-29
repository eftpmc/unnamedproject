import { registerTool } from '../registry.js';
import { readChat } from '../../tools/read_chat.js';
import { getDb } from '../../db/index.js';

export function registerChatHandlers(): void {
  registerTool({
    name: 'list_chats',
    description: 'List recent chat sessions, optionally filtered by project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    handler: async (args, userId) => {
      const limit = Math.min(100, (args.limit as number | undefined) ?? 20);
      const filterProject = args.project_id as string | undefined;
      const rows = filterProject
        ? getDb().prepare('SELECT id, title, updated_at, pinned_project_id FROM sessions WHERE user_id = ? AND pinned_project_id = ? ORDER BY updated_at DESC LIMIT ?').all(userId, filterProject, limit)
        : getDb().prepare('SELECT id, title, updated_at, pinned_project_id FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?').all(userId, limit);
      return JSON.stringify(rows, null, 2);
    },
  });

  registerTool({
    name: 'read_chat',
    description: 'Read the full message history of a chat session',
    inputSchema: {
      type: 'object',
      properties: { chat_id: { type: 'string' } },
      required: ['chat_id'],
    },
    handler: async (args, userId) => readChat(userId, args.chat_id as string),
  });
}
