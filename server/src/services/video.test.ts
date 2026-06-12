import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'path';
import { buildMediaPath } from './video.js';

describe('buildMediaPath', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a dir ending in projects/<projectId>/media', () => {
    const { dir } = buildMediaPath('proj123', 'My Cool Video');
    expect(dir.endsWith(path.join('projects', 'proj123', 'media'))).toBe(true);
  });

  it('returns a sanitized fileName matching the expected pattern', () => {
    const { fileName } = buildMediaPath('proj123', 'My Cool Video');
    expect(fileName).toMatch(/^\d+-[a-z0-9-]+\.mp4$/);
    expect(fileName).toContain('my-cool-video');
  });

  it('produces different filenames for different timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const first = buildMediaPath('proj123', 'My Cool Video');

    vi.setSystemTime(2000);
    const second = buildMediaPath('proj123', 'My Cool Video');

    expect(first.fileName).not.toBe(second.fileName);
  });

  it('falls back to "video" slug for empty/special-character titles', () => {
    const { fileName } = buildMediaPath('proj123', '!!!');
    expect(fileName).toMatch(/^\d+-video\.mp4$/);

    const { fileName: emptyFileName } = buildMediaPath('proj123', '');
    expect(emptyFileName).toMatch(/^\d+-video\.mp4$/);
  });
});
