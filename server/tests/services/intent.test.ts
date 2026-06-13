import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { extractIntentWithClient, DEFAULT_INTENT } from '../../src/services/intent.js';

function mockClient(responseText: string): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  } as unknown as Anthropic;
}

describe('extractIntentWithClient', () => {
  it('parses a valid intent response', async () => {
    const json = JSON.stringify({
      domain: 'code',
      complexity: 'medium',
      model: 'sonnet',
      tools: ['invoke_claude_code'],
      scope: 'delegate',
      needs_research: false,
      ambiguous: false,
    });
    const result = await extractIntentWithClient('build me a login page', mockClient(json));
    expect(result.domain).toBe('code');
    expect(result.scope).toBe('delegate');
    expect(result.ambiguous).toBe(false);
    expect(result.tools).toContain('invoke_claude_code');
  });

  it('accepts the full real tool surface in tool hints', async () => {
    const json = JSON.stringify({
      domain: 'multi',
      complexity: 'high',
      model: 'opus',
      tools: ['create_campaign', 'mcp_call', 'create_artifact', 'project_query', 'rebuild_graph', 'create_scheduled_task'],
      scope: 'campaign',
      needs_research: true,
      ambiguous: false,
    });
    const result = await extractIntentWithClient('coordinate this work', mockClient(json));
    expect(result.tools).toEqual([
      'create_campaign',
      'mcp_call',
      'create_artifact',
      'project_query',
      'rebuild_graph',
      'create_scheduled_task',
    ]);
  });

  it('filters nonexistent tool names such as image_gen', async () => {
    const json = JSON.stringify({
      domain: 'image',
      complexity: 'medium',
      model: 'sonnet',
      tools: ['image_gen', 'web_search'],
      scope: 'inline',
      needs_research: false,
      ambiguous: false,
    });
    const result = await extractIntentWithClient('make an image', mockClient(json));
    expect(result.tools).toEqual(['web_search']);
  });

  it('returns DEFAULT_INTENT when the response is not valid JSON', async () => {
    const result = await extractIntentWithClient('hello', mockClient('not json at all'));
    expect(result).toEqual(DEFAULT_INTENT);
  });

  it('returns DEFAULT_INTENT when the API call throws', async () => {
    const broken: Anthropic = {
      messages: {
        create: async () => { throw new Error('network error'); },
      },
    } as unknown as Anthropic;
    const result = await extractIntentWithClient('anything', broken);
    expect(result).toEqual(DEFAULT_INTENT);
  });

  it('fills in missing fields with defaults on partial response', async () => {
    const partial = JSON.stringify({ domain: 'writing' }); // missing most fields
    const result = await extractIntentWithClient('write an email', mockClient(partial));
    expect(result.domain).toBe('writing');
    expect(result.complexity).toBe(DEFAULT_INTENT.complexity);
    expect(result.model).toBe(DEFAULT_INTENT.model);
    expect(result.scope).toBe(DEFAULT_INTENT.scope);
    expect(result.needs_research).toBe(false);
    expect(result.ambiguous).toBe(true); // DEFAULT_INTENT.ambiguous is true
  });

  it('truncates very long messages to 1000 chars before sending', async () => {
    let capturedContent = '';
    const spy: Anthropic = {
      messages: {
        create: async (params: { messages: Array<{ content: string }> }) => {
          capturedContent = params.messages[0].content;
          return { content: [{ type: 'text', text: JSON.stringify(DEFAULT_INTENT) }] };
        },
      },
    } as unknown as Anthropic;
    await extractIntentWithClient('x'.repeat(5000), spy);
    expect(capturedContent.length).toBeLessThanOrEqual(1000);
  });
});
