import fs from 'fs';
import path from 'path';
import { registerTool } from '../registry.js';
import { getItemsForSpace, getItemById } from '../../services/items.js';
import type { Block } from '../../services/items.js';
import {
  runCreateItem,
  runUpdateItem,
  runReadItem,
  runListItemTypes,
  runDefineItemType,
} from '../../tools/item_ops.js';
import { getDb, getDataDir } from '../../db/index.js';
import { newId } from '../../lib/ids.js';

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
    description: 'Create a new item in a space. Use list_item_types to see available types and their required fields. For long-form text content (documents, notes, resumes, specs), use update_item with append_blocks after creating — fields are for short structured metadata only.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', description: 'Type ID from list_item_types (e.g. blank, spec, repo)' },
        fields: { type: 'object', description: 'Short structured metadata fields only (URLs, statuses, dates, short labels). For long text, use update_item append_blocks instead.' },
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

  registerTool({
    name: 'attach_file_to_item',
    description: 'Copy a file from a message attachment into an item\'s file storage. Use when the user has attached a file in chat and you want to store it permanently in an item. Returns the stored file\'s id and url — use these in a file-preview page block.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string' },
        message_attachment_path: { type: 'string', description: 'The storage path of the message attachment (from the <attachments> block in the prompt)' },
        filename: { type: 'string', description: 'Filename to use (defaults to the original filename)' },
      },
      required: ['space_id', 'item_id', 'message_attachment_path'],
    },
    handler: async (args, userId) => {
      const item = getItemById(args.item_id as string);
      if (!item || item.space_id !== (args.space_id as string)) return JSON.stringify({ error: 'Item not found' });

      const srcPath = args.message_attachment_path as string;
      if (!fs.existsSync(srcPath)) return JSON.stringify({ error: 'Source file not found' });

      const srcFilename = (args.filename as string | undefined) ?? path.basename(srcPath).replace(/^[^-]+-/, '');
      const stat = fs.statSync(srcPath);
      const mimeType = srcPath.endsWith('.pdf') ? 'application/pdf'
        : srcPath.endsWith('.png') ? 'image/png'
        : srcPath.endsWith('.jpg') || srcPath.endsWith('.jpeg') ? 'image/jpeg'
        : srcPath.endsWith('.gif') ? 'image/gif'
        : srcPath.endsWith('.webp') ? 'image/webp'
        : 'application/octet-stream';

      const fileId = newId();
      const dir = path.join(getDataDir(), 'item-files', userId, args.space_id as string, item.id);
      fs.mkdirSync(dir, { recursive: true });
      const destPath = path.join(dir, `${fileId}-${srcFilename}`);
      fs.copyFileSync(srcPath, destPath);

      getDb()
        .prepare('INSERT INTO item_files (id, item_id, filename, mime_type, size_bytes, storage_path) VALUES (?,?,?,?,?,?)')
        .run(fileId, item.id, srcFilename, mimeType, stat.size, destPath);

      const apiBase = `/spaces/${args.space_id}/items/${item.id}/files/${fileId}`;
      return JSON.stringify({
        file_id: fileId,
        filename: srcFilename,
        mime_type: mimeType,
        size_bytes: stat.size,
        url: apiBase,
        preview_block: {
          type: 'file-preview',
          file_id: fileId,
          filename: srcFilename,
          mime_type: mimeType,
          url: apiBase,
        },
      });
    },
  });
}
