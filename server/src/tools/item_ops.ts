import { getSpaceForUser } from '../db/index.js';
import {
  createDocumentItem,
  createNoteItem,
  createRepoItem,
  updateDocumentBlocks,
  updateNoteContent,
  updateRepoOverviewBlocks,
  getItemById,
  readItemContent,
  type Block,
} from '../services/items.js';
import { ITEM_TEMPLATES } from '../lib/item-templates.js';

export async function runCreateItem(
  input: {
    space_id: string;
    name: string;
    type: string;
    template?: string;
    blocks?: Block[];
    repo_path?: string;
    default_branch?: string;
    content?: string;
  },
  userId: string,
): Promise<string> {
  const space = getSpaceForUser(input.space_id, userId);
  if (!space) return `Error: space ${input.space_id} not found`;

  const name = input.name?.trim();
  if (!name) return 'Error: name is required';

  if (input.type === 'document') {
    const template = input.template ?? 'document';
    const blocks =
      Array.isArray(input.blocks) && input.blocks.length > 0
        ? input.blocks
        : (ITEM_TEMPLATES[template] ?? ITEM_TEMPLATES['document']);
    const item = createDocumentItem({ space_id: input.space_id, name, template, blocks });
    return JSON.stringify(item);
  }

  if (input.type === 'repo') {
    if (!input.repo_path) return 'Error: repo_path required for type repo';
    const item = createRepoItem({
      space_id: input.space_id,
      name,
      repo_path: input.repo_path,
      default_branch: input.default_branch,
    });
    return JSON.stringify(item);
  }

  if (input.type === 'note') {
    const item = createNoteItem({ space_id: input.space_id, name, content: input.content ?? '' });
    return JSON.stringify(item);
  }

  return `Error: unsupported type '${input.type}'. Supported: document, repo, note`;
}

export async function runUpdateItem(
  input: {
    space_id: string;
    item_id: string;
    blocks?: Block[];
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
    updateDocumentBlocks(item.id, input.blocks);
  }

  if (input.overview_blocks !== undefined) {
    if (item.type !== 'repo') return `Error: overview_blocks only applies to repo items`;
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
