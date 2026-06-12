import { describe, it, expect } from 'vitest';
import { PROJECT_TYPES, isValidProjectType } from './projectTypes.js';

describe('projectTypes', () => {
  it('includes default and video', () => {
    expect(PROJECT_TYPES).toContain('default');
    expect(PROJECT_TYPES).toContain('video');
  });

  it('validates known types', () => {
    expect(isValidProjectType('default')).toBe(true);
    expect(isValidProjectType('video')).toBe(true);
  });

  it('rejects unknown types', () => {
    expect(isValidProjectType('not-a-type')).toBe(false);
  });
});
