import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import type { Block } from './items.js';

export interface ItemTemplate {
  id: string;
  user_id: string | null;
  kind: 'system' | 'blocks';
  name: string;
  blocks: Block[] | null;
  item_type: 'repo' | 'file' | 'note' | 'document';
  is_builtin: boolean;
  created_at: number;
}

interface ItemTemplateRow {
  id: string;
  user_id: string | null;
  kind: 'system' | 'blocks';
  name: string;
  blocks: string | null;
  item_type: 'repo' | 'file' | 'note' | 'document';
  is_builtin: number;
  created_at: number;
}

function hydrate(row: ItemTemplateRow): ItemTemplate {
  return {
    ...row,
    blocks: row.blocks ? (JSON.parse(row.blocks) as Block[]) : null,
    is_builtin: row.is_builtin === 1,
  };
}

export function listItemTemplates(userId: string): ItemTemplate[] {
  const rows = getDb()
    .prepare('SELECT * FROM item_templates WHERE user_id IS NULL OR user_id = ? ORDER BY is_builtin DESC, created_at ASC')
    .all(userId) as ItemTemplateRow[];
  return rows.map(hydrate);
}

export function getItemTemplate(id: string): ItemTemplate | undefined {
  const row = getDb().prepare('SELECT * FROM item_templates WHERE id = ?').get(id) as ItemTemplateRow | undefined;
  return row ? hydrate(row) : undefined;
}

export function createItemTemplate(userId: string, name: string, blocks: Block[]): ItemTemplate {
  const row: ItemTemplateRow = {
    id: newId(),
    user_id: userId,
    kind: 'blocks',
    name,
    blocks: JSON.stringify(blocks),
    item_type: 'document',
    is_builtin: 0,
    created_at: Math.floor(Date.now() / 1000),
  };
  getDb().prepare(`
    INSERT INTO item_templates (id, user_id, kind, name, blocks, item_type, is_builtin, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.user_id, row.kind, row.name, row.blocks, row.item_type, row.is_builtin, row.created_at);
  return hydrate(row);
}

export function updateItemTemplate(id: string, blocks: Block[], name?: string): ItemTemplate | undefined {
  const existing = getItemTemplate(id);
  if (!existing || existing.kind !== 'blocks') return undefined;
  getDb().prepare('UPDATE item_templates SET blocks = ?, name = COALESCE(?, name) WHERE id = ?')
    .run(JSON.stringify(blocks), name ?? null, id);
  return getItemTemplate(id);
}
