import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const APP_ROOT = path.resolve(__dirname, '../../..');

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'default';
}

export function expandUserPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith(`~${path.sep}`)) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

export function resolveWorkspacePath(input: string): string {
  return path.resolve(expandUserPath(input));
}

export function defaultWorkspaceRoot(): string {
  return process.env.UNNAMED_WORKSPACE_ROOT
    ? resolveWorkspacePath(process.env.UNNAMED_WORKSPACE_ROOT)
    : path.join(os.homedir(), '.unnamed', 'workspaces');
}

export function defaultProjectsRoot(userId: string): string {
  return path.join(defaultWorkspaceRoot(), 'projects', safeSegment(userId));
}

export function defaultProjectFilesRoot(): string {
  return path.join(defaultWorkspaceRoot(), 'project-files');
}

export function defaultAgentRuntimeRoot(): string {
  return path.join(defaultWorkspaceRoot(), 'runtime');
}

export function isPathInsideAppRoot(candidatePath: string): boolean {
  const resolved = path.resolve(candidatePath);
  const rel = path.relative(APP_ROOT, resolved);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

export function assertOutsideAppRoot(candidatePath: string, label: string): void {
  if (isPathInsideAppRoot(candidatePath)) {
    throw new Error(`${label} must be outside the Unnamed app repository (${APP_ROOT})`);
  }
}
