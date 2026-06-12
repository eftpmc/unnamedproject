import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { resolveModelForEffort, resolveModelForTurn } from '../../src/services/anthropic.js';
import type { Intent } from '../../src/services/intent.js';

function mockClient(modelIds: string[]): Anthropic {
  return {
    models: {
      list: async () => ({
        data: modelIds.map(id => ({
          id,
          display_name: id,
          created_at: '2026-01-01T00:00:00Z',
          type: 'model',
        })),
      }),
    },
  } as unknown as Anthropic;
}

describe('anthropic model selection', () => {
  it('chooses model families by effort', async () => {
    const client = mockClient([
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ]);

    await expect(resolveModelForEffort(client, 'low')).resolves.toBe('claude-haiku-4-5-20251001');
    await expect(resolveModelForEffort(client, 'medium')).resolves.toBe('claude-sonnet-4-6');
    await expect(resolveModelForEffort(client, 'high')).resolves.toBe('claude-opus-4-8');
  });

  it('prefers fable over opus for high effort when available', async () => {
    const client = mockClient(['claude-opus-4-8', 'claude-fable-5', 'claude-sonnet-4-6']);

    await expect(resolveModelForEffort(client, 'high')).resolves.toBe('claude-fable-5');
  });
});

const sonnetIntent: Intent = {
  domain: 'code', complexity: 'medium', model: 'sonnet',
  tools: [], scope: 'delegate', needs_research: false, ambiguous: false,
};
const haikuIntent: Intent = {
  domain: 'research', complexity: 'low', model: 'haiku',
  tools: [], scope: 'inline', needs_research: false, ambiguous: false,
};
const opusIntent: Intent = {
  domain: 'code', complexity: 'high', model: 'opus',
  tools: [], scope: 'campaign', needs_research: false, ambiguous: false,
};

describe('resolveModelForTurn', () => {
  it('picks the model family from intent', async () => {
    const client = mockClient([
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ]);
    await expect(resolveModelForTurn(client, sonnetIntent, 'high')).resolves.toBe('claude-sonnet-4-6');
    await expect(resolveModelForTurn(client, haikuIntent, 'high')).resolves.toBe('claude-haiku-4-5-20251001');
    await expect(resolveModelForTurn(client, opusIntent, 'high')).resolves.toBe('claude-opus-4-8');
  });

  it('applies effort ceiling: medium effort caps at sonnet', async () => {
    const client = mockClient(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    await expect(resolveModelForTurn(client, opusIntent, 'medium')).resolves.toBe('claude-sonnet-4-6');
  });

  it('applies effort ceiling: low effort caps at haiku', async () => {
    const client = mockClient(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    await expect(resolveModelForTurn(client, opusIntent, 'low')).resolves.toBe('claude-haiku-4-5-20251001');
    await expect(resolveModelForTurn(client, sonnetIntent, 'low')).resolves.toBe('claude-haiku-4-5-20251001');
  });

  it('falls back gracefully when no matching family found', async () => {
    const client = mockClient(['claude-sonnet-4-6']); // no haiku
    const result = await resolveModelForTurn(client, haikuIntent, 'high');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
