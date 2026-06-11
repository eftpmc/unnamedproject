import { rememberFact, recallFact, forgetFact, recallAll, projectNameFor, type MemoryType } from '../services/memory.js';

const TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference'];

function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === 'string' && (TYPES as string[]).includes(value);
}

export function remember(userId: string, type: string, key: string, value: string, projectId?: string): string {
  if (!isMemoryType(type)) return `Error: invalid memory type '${type}'. Must be one of: ${TYPES.join(', ')}`;
  rememberFact(userId, type, key, value, projectId ?? null);
  return `Remembered [${type}] ${key}: ${value}`;
}

export function recall(userId: string, type?: string, key?: string): string {
  if (type !== undefined && !isMemoryType(type)) return `Error: invalid memory type '${type}'. Must be one of: ${TYPES.join(', ')}`;

  if (type && key) {
    const value = recallFact(userId, type, key);
    if (!value) return `No memory for [${type}] ${key}`;
    if (type === 'project') {
      const entries = recallAll(userId, 'project');
      const entry = entries.find(e => e.key === key);
      const label = `[project: ${projectNameFor(userId, entry?.project_id ?? null) ?? entry?.project_id}]`;
      return `${label} ${key}: ${value}`;
    }
    return `[${type}] ${key}: ${value}`;
  }

  const entries = recallAll(userId, type as MemoryType | undefined);
  if (entries.length === 0) return 'No memories stored yet.';
  return entries
    .map(e => {
      const label = e.type === 'project'
        ? `[project: ${projectNameFor(userId, e.project_id) ?? e.project_id}]`
        : `[${e.type}]`;
      return `${label} ${e.key}: ${e.value}`;
    })
    .join('\n');
}

export function forget(userId: string, type: string, key: string): string {
  if (!isMemoryType(type)) return `Error: invalid memory type '${type}'. Must be one of: ${TYPES.join(', ')}`;
  const removed = forgetFact(userId, type, key);
  return removed ? `Forgot [${type}] ${key}` : `No memory for [${type}] ${key}`;
}
