import { describe, it, expect } from 'vitest';
import { detectFileKind } from './FileBrowser';

describe('detectFileKind', () => {
  it('detects images', () => {
    expect(detectFileKind('foo/bar.png')).toBe('image');
  });

  it('is case insensitive', () => {
    expect(detectFileKind('video.MP4')).toBe('video');
  });

  it('detects mov as video', () => {
    expect(detectFileKind('clip.mov')).toBe('video');
  });

  it('detects audio', () => {
    expect(detectFileKind('track.mp3')).toBe('audio');
  });

  it('defaults markdown to text', () => {
    expect(detectFileKind('README.md')).toBe('text');
  });

  it('defaults files without extension to text', () => {
    expect(detectFileKind('noextension')).toBe('text');
  });
});
