import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import type { Block } from './items.js';
import type { ItemSchema } from '../lib/item-schema.js';

export interface ItemType {
  id: string;
  user_id: string | null;
  name: string;
  schema: ItemSchema;
  capabilities: string[];
  blocks: Block[] | null;
  is_builtin: boolean;
  created_at: number;
}

interface ItemTypeRow {
  id: string;
  user_id: string | null;
  kind: string;
  name: string;
  schema: string | null;
  capabilities: string | null;
  blocks: string | null;
  is_builtin: number;
  created_at: number;
}

function hydrate(row: ItemTypeRow): ItemType {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    schema: row.schema ? JSON.parse(row.schema) as ItemSchema : {},
    capabilities: row.capabilities ? JSON.parse(row.capabilities) as string[] : [],
    blocks: row.blocks ? JSON.parse(row.blocks) as Block[] : null,
    is_builtin: row.is_builtin === 1,
    created_at: row.created_at,
  };
}

export function listItemTypes(userId: string): ItemType[] {
  const rows = getDb()
    .prepare('SELECT * FROM item_templates WHERE user_id IS NULL OR user_id = ? ORDER BY is_builtin DESC, created_at ASC')
    .all(userId) as ItemTypeRow[];
  return rows.map(hydrate);
}

export function getItemType(id: string): ItemType | undefined {
  const row = getDb().prepare('SELECT * FROM item_templates WHERE id = ?').get(id) as ItemTypeRow | undefined;
  return row ? hydrate(row) : undefined;
}

export function upsertItemType(
  userId: string,
  name: string,
  schema: ItemSchema,
  capabilities: string[],
  blocks: Block[],
): ItemType {
  const existing = getDb().prepare(
    'SELECT id, is_builtin FROM item_templates WHERE name = ? AND (user_id = ? OR user_id IS NULL)',
  ).get(name, userId) as { id: string; is_builtin: number } | undefined;

  if (existing?.is_builtin) {
    throw new Error(`cannot redefine builtin type '${name}'`);
  }

  if (existing) {
    getDb().prepare(
      'UPDATE item_templates SET schema = ?, capabilities = ?, blocks = ? WHERE id = ?',
    ).run(JSON.stringify(schema), JSON.stringify(capabilities), JSON.stringify(blocks), existing.id);
    return getItemType(existing.id)!;
  }

  const id = newId();
  getDb().prepare(`
    INSERT INTO item_templates (id, user_id, kind, name, schema, capabilities, blocks, is_builtin, created_at)
    VALUES (?, ?, 'blocks', ?, ?, ?, ?, 0, unixepoch())
  `).run(id, userId, name, JSON.stringify(schema), JSON.stringify(capabilities), JSON.stringify(blocks));
  return getItemType(id)!;
}

// Backward-compat aliases
export const listItemTemplates = listItemTypes;
export const getItemTemplate = getItemType;

export function createItemTemplate(userId: string, name: string, blocks: Block[]): ItemType {
  return upsertItemType(userId, name, {}, [], blocks);
}

export function updateItemTemplate(id: string, blocks: Block[], name?: string): ItemType | undefined {
  const existing = getItemType(id);
  if (!existing || existing.is_builtin) return undefined;
  getDb().prepare('UPDATE item_templates SET blocks = ?, name = COALESCE(?, name) WHERE id = ?')
    .run(JSON.stringify(blocks), name ?? null, id);
  return getItemType(id);
}

export function deleteItemTemplate(id: string): boolean {
  const existing = getItemType(id);
  if (!existing || existing.is_builtin) return false;
  getDb().prepare('DELETE FROM item_templates WHERE id = ? AND is_builtin = 0').run(id);
  return true;
}
