import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerProcess, killProcess, unregisterProcess } from '../../src/lib/process-registry.js';
import type { ChildProcess } from 'child_process';

function makeProc(): ChildProcess {
  return { kill: vi.fn() } as unknown as ChildProcess;
}

beforeEach(() => {
  // Clean up any leftover registrations from prior tests
  unregisterProcess('e1');
  unregisterProcess('e2');
});

describe('process-registry', () => {
  it('killProcess returns false for unknown id', () => {
    expect(killProcess('nonexistent')).toBe(false);
  });

  it('registers and kills a process with SIGTERM', () => {
    const proc = makeProc();
    registerProcess('e1', proc);
    const result = killProcess('e1');
    expect(result).toBe(true);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('killProcess removes entry so second call returns false', () => {
    const proc = makeProc();
    registerProcess('e1', proc);
    killProcess('e1');
    expect(killProcess('e1')).toBe(false);
  });

  it('unregisterProcess removes without killing', () => {
    const proc = makeProc();
    registerProcess('e2', proc);
    unregisterProcess('e2');
    expect(killProcess('e2')).toBe(false);
    expect(proc.kill).not.toHaveBeenCalled();
  });
});
