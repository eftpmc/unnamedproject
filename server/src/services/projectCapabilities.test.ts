import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock('fs');
});

describe('detectCapabilities', () => {
  it('has_graph is true when .project-index.json exists', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-test-'));
    fs.writeFileSync(path.join(tmpDir, '.project-index.json'), '{}');

    const { detectCapabilities } = await import('./projectCapabilities.js');
    expect(detectCapabilities('proj-1', tmpDir).has_graph).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has_graph is false when no .project-index.json', async () => {
    const { detectCapabilities } = await import('./projectCapabilities.js');
    expect(detectCapabilities('proj-2', '/tmp/empty-repo').has_graph).toBe(false);
  });

  it('has_graph is false when repoPath is not provided', async () => {
    const { detectCapabilities } = await import('./projectCapabilities.js');
    expect(detectCapabilities('proj-3').has_graph).toBe(false);
  });
});
