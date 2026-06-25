import { registerTool } from '../registry.js';
import { getItemsForSpace, createNoteItem, type Block } from '../../services/items.js';
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
    handler: async (args) => JSON.stringify(getItemsForSpace(args.space_id as string), null, 2),
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
    description: 'Create a new item in a space (repo, file, note, or document)',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', enum: ['repo', 'file', 'note', 'document'] },
        template_id: { type: 'string' },
        repo_path: { type: 'string' },
        default_branch: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['space_id', 'name', 'type'],
    },
    handler: async (args, userId) =>
      runCreateItem(
        {
          space_id: args.space_id as string,
          name: args.name as string,
          type: args.type as string,
          template_id: args.template_id as string | undefined,
          repo_path: args.repo_path as string | undefined,
          default_branch: args.default_branch as string | undefined,
          content: args.content as string | undefined,
          source_session_id: null,
          source_plan_id: null,
          source_step_id: null,
        },
        userId,
      ),
  });

  registerTool({
    name: 'update_item',
    description: "Update an item's content or blocks",
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string' },
        content: { type: 'string' },
        blocks: { type: 'array' },
        block_id: { type: 'string' },
        block: { type: 'object' },
        overview_blocks: { type: 'array' },
      },
      required: ['space_id', 'item_id'],
    },
    handler: async (args, userId) =>
      runUpdateItem(
        {
          space_id: args.space_id as string,
          item_id: args.item_id as string,
          content: args.content as string | undefined,
          blocks: args.blocks as Block[] | undefined,
          block_id: args.block_id as string | undefined,
          block: args.block as Block | undefined,
          overview_blocks: args.overview_blocks as Block[] | null | undefined,
        },
        userId,
      ),
  });

  registerTool({
    name: 'create_note',
    description: 'Create a note item in a space',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        name: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['space_id', 'name', 'content'],
    },
    handler: async (args) => {
      const item = createNoteItem({
        space_id: args.space_id as string,
        name: args.name as string,
        content: args.content as string,
        source_session_id: null,
        source_plan_id: null,
        source_step_id: null,
      });
      return JSON.stringify(item);
    },
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
    handler: async (args) =>
      runUpdateItemTemplate({
        template_id: args.template_id as string,
        name: args.name as string | undefined,
        blocks: args.blocks as Block[],
      }),
  });
}
