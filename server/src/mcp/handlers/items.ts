import { registerTool } from '../registry.js';
import { getItemsForSpace, type Block } from '../../services/items.js';
import {
  runCreateItem,
  runUpdateItem,
  runReadItem,
  runListItemTypes,
  runDefineItemType,
} from '../../tools/item_ops.js';

export function registerItemHandlers(): void {
  registerTool({
    name: 'list_items',
    description: 'List items in a space. Optionally filter by type and/or field values.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        type: { type: 'string', description: 'Filter to items of this type (e.g. repo, experiment)' },
        fields: { type: 'object', description: 'Filter by exact field values (e.g. { status: "failed" })' },
      },
      required: ['space_id'],
    },
    handler: async (args, _userId) => JSON.stringify(
      getItemsForSpace(
        args.space_id as string,
        (args.type || args.fields) ? { type: args.type as string | undefined, fields: args.fields as Record<string, unknown> | undefined } : undefined,
      ),
      null, 2,
    ),
  });

  registerTool({
    name: 'read_item',
    description: 'Read the content of a space item. For file-readable items, includes file content.',
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
    description: 'Create a new item in a space. Use list_item_types to see available types and their required fields.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', description: 'Type ID from list_item_types (e.g. blank, spec, repo)' },
        fields: { type: 'object', description: 'Typed field values — validated against the type schema' },
      },
      required: ['space_id', 'name', 'type'],
    },
    handler: async (args, userId, sessionId) =>
      runCreateItem(
        {
          space_id: args.space_id as string,
          name: args.name as string,
          type: args.type as string,
          fields: args.fields as Record<string, unknown> | undefined,
          source_session_id: sessionId,
        },
        userId,
        sessionId,
      ),
  });

  registerTool({
    name: 'update_item',
    description: "Update an item's fields and/or page blocks. fields uses patch semantics (merged). Use append_blocks to add blocks without a full read.",
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string' },
        fields: { type: 'object', description: 'Patch typed fields — merged into existing values' },
        page_blocks: { type: 'array', description: 'Full replacement of all page blocks' },
        append_blocks: { type: 'array', description: 'Append blocks after existing content' },
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
          fields: args.fields as Record<string, unknown> | undefined,
          page_blocks: args.page_blocks as Block[] | undefined,
          append_blocks: args.append_blocks as Block[] | undefined,
          block_id: args.block_id as string | undefined,
          block: args.block as Block | undefined,
        },
        userId,
        sessionId,
      ),
  });

  registerTool({
    name: 'list_item_types',
    description: 'List all available item types with their schema, capabilities, and default block layout',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => runListItemTypes(userId),
  });

  registerTool({
    name: 'define_item_type',
    description: 'Define a new item type with a backend schema (typed fields), capability primitives, and default frontend blocks. Call again with the same name to update an existing custom type.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the type' },
        schema: {
          type: 'object',
          description: 'Field definitions: { fieldName: { type: "string"|"number"|"boolean"|"enum", required?: boolean, options?: string[] } }',
        },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Platform capability primitives: git-aware, file-readable, web-fetchable, embeddable, schedulable',
        },
        blocks: {
          type: 'array',
          description: 'Default page block layout for new items of this type',
        },
      },
      required: ['name', 'schema', 'capabilities', 'blocks'],
    },
    handler: async (args, userId) =>
      runDefineItemType(
        {
          name: args.name as string,
          schema: args.schema,
          capabilities: args.capabilities,
          blocks: args.blocks as Block[],
        },
        userId,
      ),
  });
}
