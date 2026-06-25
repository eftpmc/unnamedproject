import { getSpaceForUser } from '../db/index.js';
import {
  createDocumentItem,
  createNoteItem,
  createRepoItem,
  updateDocumentBlocks,
  updateDocumentBlock,
  updateNoteContent,
  updateRepoOverviewBlocks,
  getItemById,
  readItemContent,
  type Block,
} from '../services/items.js';
import { listItemTemplates, getItemTemplate, createItemTemplate, updateItemTemplate } from '../services/templates.js';
import { validateBlock, validateBlocks } from '../lib/blocks.js';

export async function runCreateItem(
  input: {
    space_id: string;
    name: string;
    type: string;
    template_id?: string;
    repo_path?: string;
    default_branch?: string;
    content?: string;
    source_session_id?: string | null;
  },
  userId: string,
): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return `Error: space ${input.space_id} not found`;

  const name = input.name?.trim();
  if (!name) return 'Error: name is required';

  const provenance = {
    source_session_id: input.source_session_id,
  };

  if (input.type === 'document') {
    const templateId = input.template_id ?? 'tpl_document';
    const template = getItemTemplate(templateId);
    if (!template || template.kind !== 'blocks') {
      return `Error: unknown template '${templateId}'. Use list_item_templates to see available templates.`;
    }
    const item = createDocumentItem({
      space_id: input.space_id,
      name,
      template_id: templateId,
      blocks: template.blocks ?? [],
      ...provenance,
    });
    return JSON.stringify(item);
  }

  if (input.type === 'repo') {
    if (!input.repo_path) return 'Error: repo_path required for type repo';
    const item = createRepoItem({
      space_id: input.space_id,
      name,
      repo_path: input.repo_path,
      default_branch: input.default_branch,
      ...provenance,
    });
    return JSON.stringify(item);
  }

  if (input.type === 'note') {
    const item = createNoteItem({ space_id: input.space_id, name, content: input.content ?? '', ...provenance });
    return JSON.stringify(item);
  }

  return `Error: unsupported type '${input.type}'. Supported: document, repo, note`;
}

export async function runUpdateItem(
  input: {
    space_id: string;
    item_id: string;
    blocks?: Block[];
    block_id?: string;
    block?: Block;
    overview_blocks?: Block[] | null;
    content?: string;
  },
  userId: string,
): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return `Error: space ${input.space_id} not found`;

  const item = getItemById(input.item_id);
  if (!item || item.space_id !== input.space_id) return `Error: item ${input.item_id} not found`;

  if (input.blocks !== undefined) {
    if (item.type !== 'document') return `Error: blocks only applies to document items`;
    if (!Array.isArray(input.blocks)) return 'Error: blocks must be an array';
    const blocksError = validateBlocks(input.blocks);
    if (blocksError) return `Error: ${blocksError}`;
    updateDocumentBlocks(item.id, input.blocks);
  }

  if (input.block_id !== undefined) {
    if (item.type !== 'document') return `Error: block_id only applies to document items`;
    if (!input.block || typeof input.block !== 'object') return 'Error: block is required when block_id is set';
    const blockError = validateBlock(input.block, 'block');
    if (blockError) return `Error: ${blockError}`;
    const found = updateDocumentBlock(item.id, input.block_id, input.block);
    if (!found) return `Error: no block with id '${input.block_id}' on item ${item.id} — it may predate having an id, in which case use blocks (full replace) instead`;
  }

  if (input.overview_blocks !== undefined) {
    if (item.type !== 'repo') return `Error: overview_blocks only applies to repo items`;
    if (input.overview_blocks !== null) {
      const overviewError = validateBlocks(input.overview_blocks);
      if (overviewError) return `Error: ${overviewError}`;
    }
    updateRepoOverviewBlocks(item.id, input.overview_blocks);
  }

  if (input.content !== undefined) {
    if (item.type !== 'note') return `Error: content only applies to note items`;
    updateNoteContent(item.id, input.content);
  }

  return JSON.stringify(getItemById(item.id));
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
