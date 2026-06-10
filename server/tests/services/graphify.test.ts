import { describe, it, expect, vi } from 'vitest';
import { queryGraph } from '../../src/services/graphify.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn((ev: string, cb: (d: Buffer) => void) => { if (ev === 'data') cb(Buffer.from('auth.ts: handles JWT verification')); }) },
    stderr: { on: vi.fn() },
    on: vi.fn((ev: string, cb: (code: number) => void) => { if (ev === 'close') cb(0); }),
  })),
}));

describe('graphify', () => {
  it('returns query result from subprocess stdout', async () => {
    const result = await queryGraph('/tmp/repo', 'What handles authentication?');
    expect(result).toContain('auth.ts');
  });
});
