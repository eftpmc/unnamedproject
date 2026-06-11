import type { ChildProcess } from 'child_process';

const registry = new Map<string, ChildProcess>();

export function registerProcess(executionId: string, proc: ChildProcess): void {
  registry.set(executionId, proc);
}

export function killProcess(executionId: string): boolean {
  const proc = registry.get(executionId);
  if (!proc) return false;
  proc.kill('SIGTERM');
  registry.delete(executionId);
  return true;
}

export function unregisterProcess(executionId: string): void {
  registry.delete(executionId);
}
