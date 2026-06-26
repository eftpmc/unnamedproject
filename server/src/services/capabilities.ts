import fs from 'fs/promises';
import type { ItemSchema } from '../lib/item-schema.js';

export const ALLOWED_CAPABILITIES = [
  'git-aware',
  'file-readable',
  'web-fetchable',
  'embeddable',
  'schedulable',
] as const;

export type Capability = typeof ALLOWED_CAPABILITIES[number];

export const CAPABILITY_REQUIRED_FIELDS: Partial<Record<Capability, string>> = {
  'git-aware': 'repo_path',
  'file-readable': 'file_path',
  'web-fetchable': 'url',
  'schedulable': 'cron',
};

export function validateCapabilities(caps: unknown): string | null {
  if (!Array.isArray(caps)) return 'capabilities must be an array';
  for (const cap of caps) {
    if (!(ALLOWED_CAPABILITIES as readonly string[]).includes(cap)) {
      return `unknown capability '${cap}' — available: ${ALLOWED_CAPABILITIES.join(', ')}`;
    }
  }
  return null;
}

export function validateCapabilityFieldContracts(schema: ItemSchema, caps: string[]): string | null {
  for (const cap of caps) {
    const required = CAPABILITY_REQUIRED_FIELDS[cap as Capability];
    if (required && !schema[required]) {
      return `capability '${cap}' requires field '${required}' in schema`;
    }
  }
  return null;
}

export interface SpaceItemForCapability {
  id: string;
  type: string;
  page_blocks: unknown[];
  fields: Record<string, unknown>;
}

export async function onRead(
  item: SpaceItemForCapability,
  caps: string[],
): Promise<Record<string, unknown>> {
  const extra: Record<string, unknown> = {};
  if (caps.includes('file-readable') && typeof item.fields.file_path === 'string') {
    try {
      const content = await fs.readFile(item.fields.file_path);
      extra.content = content.toString();
    } catch {
      extra.content = null;
      extra.content_error = 'file not readable';
    }
  }
  return extra;
}

export async function onCreate(item: SpaceItemForCapability, caps: string[]): Promise<void> {
  await triggerEmbedding(item, caps);
}

export async function onUpdate(item: SpaceItemForCapability, caps: string[]): Promise<void> {
  await triggerEmbedding(item, caps);
}

async function triggerEmbedding(item: SpaceItemForCapability, caps: string[]): Promise<void> {
  if (!caps.includes('embeddable')) return;
  const text = buildEmbeddableText(item);
  if (!text) return;
  // Fire-and-forget — don't block the write response on embedding
  const { embed } = await import('./embeddings.js');
  embed(text).catch((err: unknown) => {
    console.error(`[embeddable] Failed to embed item ${item.id}:`, err);
  });
}

function buildEmbeddableText(item: SpaceItemForCapability): string {
  const parts: string[] = [];
  for (const block of item.page_blocks as Array<Record<string, unknown>>) {
    if (block.type === 'text' && typeof block.content === 'string') parts.push(block.content);
    if (block.type === 'heading' && typeof block.text === 'string') parts.push(block.text);
  }
  for (const value of Object.values(item.fields)) {
    if (typeof value === 'string') parts.push(value);
  }
  return parts.join('\n').trim();
}
