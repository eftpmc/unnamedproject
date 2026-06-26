import { getSpaceForUser, createSessionEvent } from '../db/index.js';
import { broadcast } from '../services/socket.js';
import {
  createItem,
  updateItemFields,
  updateItemPageBlocks,
  updateItemPageBlock,
  appendItemPageBlocks,
  getItemById,
  type Block,
} from '../services/items.js';
import { listItemTypes, getItemType, upsertItemType } from '../services/templates.js';
import { validateBlock, validateBlocks } from '../lib/blocks.js';
import { validateSchema, validateFields, type ItemSchema } from '../lib/item-schema.js';
import {
  validateCapabilities,
  validateCapabilityFieldContracts,
  onRead,
  onCreate,
  onUpdate,
} from '../services/capabilities.js';

function emitItemEvent(
  type: 'item_created' | 'item_updated',
  userId: string,
  sessionId: string,
  spaceId: string,
  itemId: string,
  itemName: string,
  itemType: string,
): void {
  const event = createSessionEvent({
    sessionId,
    type,
    title: `${type === 'item_created' ? 'Created' : 'Updated'} item: ${itemName}`,
    spaceId,
    itemId,
    metadata: { itemType },
  });
  broadcast(userId, {
    type: 'session_event_created',
    sessionId,
    event: { ...event, metadata: JSON.parse(event.metadata || '{}') },
  });
}

export async function runCreateItem(
  input: {
    space_id: string;
    name: string;
    type: string;
    fields?: Record<string, unknown>;
    source_session_id?: string | null;
  },
  userId: string,
  sessionId?: string | null,
): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return `Error: space ${input.space_id} not found`;

  const name = input.name?.trim();
  if (!name) return 'Error: name is required';

  const itemType = getItemType(input.type);
  if (!itemType) {
    return `Error: unknown item type '${input.type}'. Use list_item_types to see available types.`;
  }

  const fields = input.fields ?? {};
  const fieldsError = validateFields(fields, itemType.schema);
  if (fieldsError) return `Error: ${fieldsError}`;

  const item = createItem({
    space_id: input.space_id,
    name,
    type: input.type,
    page_blocks: itemType.blocks ?? [],
    fields,
    source_session_id: input.source_session_id,
  });

  await onCreate(item, itemType.capabilities);

  if (sessionId) emitItemEvent('item_created', userId, sessionId, input.space_id, item.id, item.name, item.type);
  return JSON.stringify(item);
}

export async function runUpdateItem(
  input: {
    space_id: string;
    item_id: string;
    fields?: Record<string, unknown>;
    page_blocks?: Block[];
    append_blocks?: Block[];
    block_id?: string;
    block?: Block;
  },
  userId: string,
  sessionId?: string | null,
): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return `Error: space ${input.space_id} not found`;

  const item = getItemById(input.item_id);
  if (!item || item.space_id !== input.space_id) return `Error: item ${input.item_id} not found`;

  if (input.fields !== undefined) {
    if (typeof input.fields !== 'object' || input.fields === null) return 'Error: fields must be an object';
    const itemType = getItemType(item.type);
    if (itemType) {
      const mergedFields = { ...item.fields, ...input.fields };
      const fieldsError = validateFields(mergedFields, itemType.schema);
      if (fieldsError) return `Error: ${fieldsError}`;
    }
    updateItemFields(item.id, input.fields);
  }

  if (input.page_blocks !== undefined) {
    if (!Array.isArray(input.page_blocks)) return 'Error: page_blocks must be an array';
    const blocksError = validateBlocks(input.page_blocks);
    if (blocksError) return `Error: ${blocksError}`;
    updateItemPageBlocks(item.id, input.page_blocks);
  }

  if (input.append_blocks !== undefined) {
    if (!Array.isArray(input.append_blocks)) return 'Error: append_blocks must be an array';
    const blocksError = validateBlocks(input.append_blocks);
    if (blocksError) return `Error: ${blocksError}`;
    appendItemPageBlocks(item.id, input.append_blocks);
  }

  if (input.block_id !== undefined) {
    if (!input.block || typeof input.block !== 'object') return 'Error: block is required when block_id is set';
    const blockError = validateBlock(input.block, 'block');
    if (blockError) return `Error: ${blockError}`;
    const found = updateItemPageBlock(item.id, input.block_id, input.block);
    if (!found) return `Error: no block with id '${input.block_id}' on item ${item.id} — it may predate having an id, use page_blocks (full replace) instead`;
  }

  const updated = getItemById(item.id)!;
  const itemType = getItemType(updated.type);
  if (itemType) await onUpdate(updated, itemType.capabilities);

  if (sessionId) emitItemEvent('item_updated', userId, sessionId, input.space_id, updated.id, updated.name, updated.type);
  return JSON.stringify(updated);
}

export async function runReadItem(
  input: { space_id: string; item_id: string },
  userId: string,
): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return `Error: space ${input.space_id} not found`;

  const item = getItemById(input.item_id);
  if (!item || item.space_id !== input.space_id) return `Error: item ${input.item_id} not found`;

  const itemType = getItemType(item.type);
  const caps = itemType?.capabilities ?? [];
  const extra = await onRead(item, caps);

  return JSON.stringify({ ...item, ...extra });
}

export async function runListItemTypes(userId: string): Promise<string> {
  return JSON.stringify(listItemTypes(userId));
}

export async function runDefineItemType(
  input: {
    name: string;
    schema: unknown;
    capabilities: unknown;
    blocks: Block[];
  },
  userId: string,
): Promise<string> {
  const name = input.name?.trim();
  if (!name) return 'Error: name is required';

  const schemaError = validateSchema(input.schema);
  if (schemaError) return `Error: ${schemaError}`;

  const capsError = validateCapabilities(input.capabilities);
  if (capsError) return `Error: ${capsError}`;

  const contractError = validateCapabilityFieldContracts(
    input.schema as ItemSchema,
    input.capabilities as string[],
  );
  if (contractError) return `Error: ${contractError}`;

  if (!Array.isArray(input.blocks)) return 'Error: blocks must be an array';
  const blocksError = validateBlocks(input.blocks);
  if (blocksError) return `Error: ${blocksError}`;

  try {
    const itemType = upsertItemType(
      userId,
      name,
      input.schema as ItemSchema,
      input.capabilities as string[],
      input.blocks,
    );
    return JSON.stringify(itemType);
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

// Backward-compat aliases
export const runListItemTemplates = runListItemTypes;

export async function runCreateItemTemplate(
  input: { name: string; blocks: Block[] },
  userId: string,
): Promise<string> {
  return runDefineItemType({ name: input.name, schema: {}, capabilities: [], blocks: input.blocks }, userId);
}

export async function runUpdateItemTemplate(
  input: { template_id: string; blocks: Block[]; name?: string },
): Promise<string> {
  if (!Array.isArray(input.blocks)) return 'Error: blocks must be an array';
  const blocksError = validateBlocks(input.blocks);
  if (blocksError) return `Error: ${blocksError}`;
  const { updateItemTemplate } = await import('../services/templates.js');
  const updated = updateItemTemplate(input.template_id, input.blocks, input.name?.trim());
  if (!updated) return `Error: template '${input.template_id}' not found or not editable`;
  return JSON.stringify(updated);
}
