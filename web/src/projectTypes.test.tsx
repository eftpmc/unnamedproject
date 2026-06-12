import { describe, it, expect } from 'vitest';
import { PROJECT_TYPE_REGISTRY } from './projectTypes.js';

describe('PROJECT_TYPE_REGISTRY', () => {
  it('has a default entry with no extra tabs', () => {
    expect(PROJECT_TYPE_REGISTRY.default.extraTabs).toEqual([]);
  });

  it('falls back to default for unknown types via getProjectTypeConfig', async () => {
    const { getProjectTypeConfig } = await import('./projectTypes.js');
    expect(getProjectTypeConfig('something-unknown')).toBe(PROJECT_TYPE_REGISTRY.default);
  });
});
