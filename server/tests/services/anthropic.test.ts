import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { resolveModelForEffort } from '../../src/services/anthropic.js';

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
