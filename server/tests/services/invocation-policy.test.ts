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

  it('resumes for explicit short continuation prompts', () => {
    expect(selectInvocationMode({
      providerSessionId: 'p1',
      prompt: 'try again',
      messageCount: 25,
    })).toBe('resume_provider_session');
  });

  it('resumes for explicit browser-continuation prompts regardless of count', () => {
    expect(selectInvocationMode({
      providerSessionId: 'p1',
      prompt: 'try clicking that again',
      messageCount: 25,
    })).toBe('resume_provider_session');
  });

  it('goes fresh when message count exceeds threshold', () => {
    expect(selectInvocationMode({
      providerSessionId: 'p1',
      prompt: 'can you clean this up',
      messageCount: 30,
    })).toBe('fresh_with_summary');
  });

  it('goes fresh when session cost exceeds threshold', () => {
    expect(selectInvocationMode({
      providerSessionId: 'p1',
      prompt: 'keep going',
      messageCount: 5,
      sessionCostUsd: 5.00,
    })).toBe('fresh_with_summary');
  });

  it('resumes for short follow-up within cost/count limits', () => {
    expect(selectInvocationMode({
      providerSessionId: 'p1',
      prompt: 'looks good',
      messageCount: 10,
      sessionCostUsd: 0.50,
    })).toBe('resume_provider_session');
  });

  it('goes fresh for explicit fresh-request patterns', () => {
    expect(selectInvocationMode({
      providerSessionId: 'p1',
      prompt: 'Update the index and be done',
      messageCount: 3,
      sessionCostUsd: 0.10,
    })).toBe('fresh_with_summary');
  });

  it('does not resume just because "page" or "login" appears in a coding task', () => {
    expect(selectInvocationMode({
      providerSessionId: 'p1',
      prompt: 'add a login page to the app',
      messageCount: 8,
      sessionCostUsd: 0.20,
    })).toBe('resume_provider_session');
  });

  it('forces fresh when session state has a loop blocker', () => {
    expect(selectInvocationMode({
      providerSessionId: 'p1',
      prompt: 'try again',
      messageCount: 4,
      sessionCostUsd: 0.10,
      blockers: ['browser click action reported success without progress repeatedly. Do not retry the same browser action; switch strategy or ask for manual intervention.'],
    })).toBe('fresh_with_summary');
  });

  it('does not force fresh for non-loop blockers', () => {
    expect(selectInvocationMode({
      providerSessionId: 'p1',
      prompt: 'try again',
      messageCount: 4,
      sessionCostUsd: 0.10,
      blockers: ['needs user to provide their API key'],
    })).toBe('resume_provider_session');
  });
});
