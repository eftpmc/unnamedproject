import { getSpaceForUser, createSessionEvent } from '../db/index.js';
import { broadcast } from '../services/socket.js';
import {
  createRepoItem,
  createTemplateItem,
  updateItemPageBlocks,
  updateItemPageBlock,
  appendItemPageBlocks,
  getItemById,
  readItemContent,
  type Block,
  type FileItem,
} from '../services/items.js';
import { listItemTemplates, getItemTemplate, createItemTemplate, updateItemTemplate } from '../services/templates.js';
import { validateBlock, validateBlocks } from '../lib/blocks.js';

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
    repo_path?: string;
    default_branch?: string;
    source_session_id?: string | null;
  },
  userId: string,
  sessionId?: string | null,
): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return `Error: space ${input.space_id} not found`;

  const name = input.name?.trim();
  if (!name) return 'Error: name is required';

  const provenance = { source_session_id: input.source_session_id };

  if (input.type === 'repo') {
    if (!input.repo_path) return 'Error: repo_path required for type repo';
    const item = createRepoItem({ space_id: input.space_id, name, repo_path: input.repo_path, default_branch: input.default_branch, ...provenance });
    if (sessionId) emitItemEvent('item_created', userId, sessionId, input.space_id, item.id, item.name, item.type);
    return JSON.stringify(item);
  }

  // All other types are template-based
  const template = getItemTemplate(input.type);
  if (!template || template.kind !== 'blocks') {
    return `Error: unknown item type '${input.type}'. Use list_item_templates to see available types.`;
  }
  const item = createTemplateItem({ space_id: input.space_id, name, type: input.type, page_blocks: template.blocks ?? [], ...provenance });
  if (sessionId) emitItemEvent('item_created', userId, sessionId, input.space_id, item.id, item.name, item.type);
  return JSON.stringify(item);
}

export async function runUpdateItem(
  input: {
    space_id: string;
    item_id: string;
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

  const updated = getItemById(item.id);
  if (sessionId && updated) emitItemEvent('item_updated', userId, sessionId, input.space_id, updated.id, updated.name, updated.type);
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

  if (item.type === 'file') {
    const content = await readItemContent(item);
    return JSON.stringify({ ...item, content: Buffer.isBuffer(content) ? `[binary: ${content.length} bytes]` : content });
  }

  return JSON.stringify(item);
}

export async function runListItemTemplates(userId: string): Promise<string> {
  return JSON.stringify(listItemTemplates(userId));
}

export async function runCreateItemTemplate(
  input: { name: string; blocks: Block[] },
  userId: string,
): Promise<string> {
  const name = input.name?.trim();
  if (!name) return 'Error: name is required';
  if (!Array.isArray(input.blocks)) return 'Error: blocks must be an array';
  const blocksError = validateBlocks(input.blocks);
  if (blocksError) return `Error: ${blocksError}`;
  return JSON.stringify(createItemTemplate(userId, name, input.blocks));
}

export async function runUpdateItemTemplate(
  input: { template_id: string; blocks: Block[]; name?: string },
): Promise<string> {
  if (!Array.isArray(input.blocks)) return 'Error: blocks must be an array';
  const blocksError = validateBlocks(input.blocks);
  if (blocksError) return `Error: ${blocksError}`;
  const updated = updateItemTemplate(input.template_id, input.blocks, input.name?.trim());
  if (!updated) return `Error: template '${input.template_id}' not found or not editable`;
  return JSON.stringify(updated);
}
