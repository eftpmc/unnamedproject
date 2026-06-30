import { registerTool } from '../registry.js';
import { remember, recall, forget } from '../../tools/memory_tools.js';

export function registerMemoryHandlers(): void {
  registerTool({
    name: 'remember',
    description: 'Store a piece of information in memory. Types: user (preferences, profile), feedback (how the user wants you to behave), project (decisions, goals, deadlines), reference (external resource locations). Use a short descriptive key and a concise value.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'string' },
        project_id: { type: 'string' },
      },
      required: ['type', 'key', 'value'],
    },
    handler: async (args, userId) =>
      remember(userId, args.type as string, args.key as string, args.value as string, args.project_id as string | undefined),
  });

  registerTool({
    name: 'recall',
    description: 'Retrieve stored memories. Call with no args to list all memories. Pass type and/or key to look up a specific entry. Use this at the start of any session to surface stored user preferences, past decisions, and project context before answering.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        key: { type: 'string' },
      },
    },
    handler: async (args, userId) =>
      recall(userId, args.type as string | undefined, args.key as string | undefined),
  });

  registerTool({
    name: 'forget',
    description: 'Delete a memory entry',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['type', 'key'],
    },
    handler: async (args, userId) =>
      forget(userId, args.type as string, args.key as string),
  });
}
