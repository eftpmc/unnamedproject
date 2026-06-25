import { registerTool } from '../registry.js';
import { remember, recall, forget } from '../../tools/memory_tools.js';

export function registerMemoryHandlers(): void {
  registerTool({
    name: 'remember',
    description: 'Store a piece of information in memory',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'string' },
        space_id: { type: 'string' },
      },
      required: ['type', 'key', 'value'],
    },
    handler: async (args, userId) =>
      remember(userId, args.type as string, args.key as string, args.value as string, args.space_id as string | undefined),
  });

  registerTool({
    name: 'recall',
    description: 'Retrieve information from memory',
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
