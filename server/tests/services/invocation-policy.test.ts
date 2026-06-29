import { describe, expect, it } from 'vitest';
import { selectInvocationMode } from '../../src/services/invocation-policy.js';

describe('selectInvocationMode', () => {
  it('starts a new provider session when none exists', () => {
    expect(selectInvocationMode({
      providerSessionId: null,
      prompt: 'hello',
      messageCount: 1,
    })).toBe('new_provider_session');
  });

  it('resumes for explicit live-continuation prompts', () => {
    expect(selectInvocationMode({
      providerSessionId: 'provider-1',
      prompt: 'try again',
      messageCount: 20,
    })).toBe('resume_provider_session');
  });

  it('uses fresh compact context for bookkeeping in long chats', () => {
    expect(selectInvocationMode({
      providerSessionId: 'provider-1',
      prompt: 'Update the index and anything else and be done there',
      messageCount: 29,
    })).toBe('fresh_with_summary');
  });

  it('defaults long ambiguous chats to fresh compact context', () => {
    expect(selectInvocationMode({
      providerSessionId: 'provider-1',
      prompt: 'can you clean this up',
      messageCount: 18,
    })).toBe('fresh_with_summary');
  });
});
