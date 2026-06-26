import { registerTool } from '../registry.js';
import { getItemsForSpace, type Block } from '../../services/items.js';
import {
  runCreateItem,
  runUpdateItem,
  runReadItem,
  runListItemTemplates,
  runCreateItemTemplate,
  runUpdateItemTemplate,
} from '../../tools/item_ops.js';

export function registerItemHandlers(): void {
  registerTool({
    name: 'list_items',
    description: 'List all items in a space',
    inputSchema: {
      type: 'object',
      properties: { space_id: { type: 'string' } },
      required: ['space_id'],
    },
    handler: async (args, _userId) => JSON.stringify(getItemsForSpace(args.space_id as string), null, 2),
  });

  registerTool({
    name: 'read_item',
    description: 'Read the content of a space item',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string' },
      },
      required: ['space_id', 'item_id'],
    },
    handler: async (args, userId) =>
      runReadItem({ space_id: args.space_id as string, item_id: args.item_id as string }, userId),
  });

  registerTool({
    name: 'create_item',
    description: 'Create a new item in a space. Use list_item_templates to see available types (e.g. blank, spec, kanban, report, repo).',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', description: 'Item type — a template ID (blank, spec, kanban, report) or repo' },
        repo_path: { type: 'string', description: 'Required when type is repo' },
        default_branch: { type: 'string' },
      },
      required: ['space_id', 'name', 'type'],
    },
    handler: async (args, userId, sessionId) =>
      runCreateItem(
        {
          space_id: args.space_id as string,
          name: args.name as string,
          type: args.type as string,
          repo_path: args.repo_path as string | undefined,
          default_branch: args.default_branch as string | undefined,
          source_session_id: sessionId,
        },
        userId,
        sessionId,
      ),
  });

  registerTool({
    name: 'update_item',
    description: "Update an item's page blocks",
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string' },
        page_blocks: { type: 'array', description: 'Full replacement of page blocks' },
        block_id: { type: 'string', description: 'Patch a single block by its id' },
        block: { type: 'object', description: 'Replacement block when block_id is set' },
      },
      required: ['space_id', 'item_id'],
    },
    handler: async (args, userId, sessionId) =>
      runUpdateItem(
        {
          space_id: args.space_id as string,
          item_id: args.item_id as string,
          page_blocks: args.page_blocks as Block[] | undefined,
          block_id: args.block_id as string | undefined,
          block: args.block as Block | undefined,
        },
        userId,
        sessionId,
      ),
  });

  registerTool({
    name: 'list_item_templates',
    description: 'List available item templates',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => runListItemTemplates(userId),
  });

  registerTool({
    name: 'create_item_template',
    description: 'Create a new item template',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        blocks: { type: 'array' },
      },
      required: ['name', 'blocks'],
    },
    handler: async (args, userId) =>
      runCreateItemTemplate({ name: args.name as string, blocks: args.blocks as Block[] }, userId),
  });

  registerTool({
    name: 'update_item_template',
    description: 'Update an item template',
    inputSchema: {
      type: 'object',
      properties: {
        template_id: { type: 'string' },
        name: { type: 'string' },
        blocks: { type: 'array' },
      },
      required: ['template_id', 'blocks'],
    },
    handler: async (args, _userId) =>
      runUpdateItemTemplate({
        template_id: args.template_id as string,
        name: args.name as string | undefined,
        blocks: args.blocks as Block[],
      }),
  });
}
