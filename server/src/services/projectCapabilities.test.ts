import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock('fs');
  vi.doUnmock('../db/index.js');
});

describe('detectCapabilities', () => {
  it('has_remotion is true when remotion entry point exists', async () => {
    vi.doMock('../db/index.js', () => ({
      getDataDir: () => '/tmp/fake-data-dir',
    }));
    vi.doMock('fs', async (importOriginal) => {
      const actual = await importOriginal<typeof fs>();
      return {
        ...actual,
        existsSync: (p: fs.PathLike) => {
          if (String(p).endsWith('index.tsx')) return true;
          return false;
        },
      };
    });
    const { detectCapabilities } = await import('./projectCapabilities.js');
    const result = detectCapabilities('proj-1');
    expect(result.has_remotion).toBe(true);
  });

  it('has_remotion is false when remotion entry point does not exist', async () => {
    vi.doMock('../db/index.js', () => ({
      getDataDir: () => '/tmp/fake-data-dir',
    }));
    vi.doMock('fs', async (importOriginal) => {
      const actual = await importOriginal<typeof fs>();
      return {
        ...actual,
        existsSync: (_p: fs.PathLike) => false,
      };
    });
    const { detectCapabilities } = await import('./projectCapabilities.js');
    const result = detectCapabilities('proj-2');
    expect(result.has_remotion).toBe(false);
  });

  it('has_media is true when media dir has files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-test-'));
    const mediaDir = path.join(tmpDir, 'projects', 'proj-3', 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'video.mp4'), 'fake');

    vi.doMock('../db/index.js', () => ({
      getDataDir: () => tmpDir,
    }));
    const { detectCapabilities } = await import('./projectCapabilities.js');
    const result = detectCapabilities('proj-3');
    expect(result.has_media).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has_media is false when media dir is empty', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-test-'));
    const mediaDir = path.join(tmpDir, 'projects', 'proj-4', 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    // no files written

    vi.doMock('../db/index.js', () => ({
      getDataDir: () => tmpDir,
    }));
    const { detectCapabilities } = await import('./projectCapabilities.js');
    const result = detectCapabilities('proj-4');
    expect(result.has_media).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has_media is true when repoPath/out/ has .mp4 files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-test-'));
    const outDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'scene.mp4'), 'fake');

    vi.doMock('../db/index.js', () => ({
      getDataDir: () => '/tmp/no-media-here',
    }));
    const { detectCapabilities } = await import('./projectCapabilities.js');
    const result = detectCapabilities('proj-5', tmpDir);
    expect(result.has_media).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has_media is false when repoPath/out/ has no .mp4 files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-test-'));
    const outDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'composition.js'), 'fake'); // not an mp4

    vi.doMock('../db/index.js', () => ({
      getDataDir: () => '/tmp/no-media-here',
    }));
    const { detectCapabilities } = await import('./projectCapabilities.js');
    const result = detectCapabilities('proj-6', tmpDir);
    expect(result.has_media).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has_graph is true when graphify-out/graph.json exists', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-test-'));
    const graphDir = path.join(tmpDir, 'graphify-out');
    fs.mkdirSync(graphDir, { recursive: true });
    fs.writeFileSync(path.join(graphDir, 'graph.json'), '{}');

    vi.doMock('../db/index.js', () => ({
      getDataDir: () => '/tmp/no-media-here',
    }));
    const { detectCapabilities } = await import('./projectCapabilities.js');
    const result = detectCapabilities('proj-7', tmpDir);
    expect(result.has_graph).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has_graph is false when no graphify-out/graph.json', async () => {
    vi.doMock('../db/index.js', () => ({
      getDataDir: () => '/tmp/no-media-here',
    }));
    const { detectCapabilities } = await import('./projectCapabilities.js');
    const result = detectCapabilities('proj-8', '/tmp/repo-with-no-graph');
    expect(result.has_graph).toBe(false);
  });

  it('has_graph is false when repoPath is not provided', async () => {
    vi.doMock('../db/index.js', () => ({
      getDataDir: () => '/tmp/no-media-here',
    }));
    const { detectCapabilities } = await import('./projectCapabilities.js');
    const result = detectCapabilities('proj-9');
    expect(result.has_graph).toBe(false);
  });
});
