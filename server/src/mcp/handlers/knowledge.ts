import { registerTool } from '../registry.js';
import { runProjectQuery } from '../../tools/project_query.js';
import { buildGraph } from '../../services/graphify.js';
import { getAnthropicKey } from '../../services/anthropic.js';

export function registerKnowledgeHandlers(): void {
  registerTool({
    name: 'project_query',
    description: 'Ask a question about a repo using the knowledge graph',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string' },
        question: { type: 'string' },
      },
      required: ['space_id', 'item_id', 'question'],
    },
    handler: async (args, userId) => {
      let key: string | null = null;
      try { key = getAnthropicKey(userId); } catch { /* none configured */ }
      return runProjectQuery(
        { space_id: args.space_id as string, item_id: args.item_id as string, question: args.question as string },
        userId,
        key,
      );
    },
  });

  registerTool({
    name: 'rebuild_graph',
    description: 'Rebuild the knowledge graph for a repo item',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string' },
      },
      required: ['space_id', 'item_id'],
    },
    handler: async (args, userId) => {
      const { getItemById } = await import('../../services/items.js');
      const item = getItemById(args.item_id as string);
      if (!item || item.space_id !== args.space_id || item.type !== 'repo') {
        return `Error: repo item ${args.item_id} not found in space ${args.space_id}`;
      }
      let key: string | null = null;
      try { key = getAnthropicKey(userId); } catch { /* none configured */ }
      await buildGraph(item.repo_path, item.id, key);
      return 'Knowledge graph rebuilt successfully.';
    },
  });
}
