import { describe, it, expect } from 'vitest';
import { classifyIntent, DEFAULT_INTENT } from '../../src/services/intent.js';

describe('classifyIntent', () => {
  it('classifies a code task', () => {
    const intent = classifyIntent('fix the login bug in the api');
    expect(intent.domain).toBe('code');
  });

  it('classifies a research task', () => {
    const intent = classifyIntent('explain how photosynthesis works');
    expect(intent.domain).toBe('research');
  });

  it('classifies a writing task', () => {
    const intent = classifyIntent('draft an email to the team');
    expect(intent.domain).toBe('writing');
  });

  it('classifies a creative task', () => {
    const intent = classifyIntent('brainstorm names for my startup');
    expect(intent.domain).toBe('creative');
  });

  it('classifies an image task', () => {
    const intent = classifyIntent('generate an image of a sunset');
    expect(intent.domain).toBe('image');
  });

  it('marks a message with no domain signal as general', () => {
    const intent = classifyIntent('hey there');
    expect(intent.domain).toBe('general');
  });

  it('classifies a message with multiple domain signals as multi', () => {
    const intent = classifyIntent('research and implement a caching layer');
    expect(intent.domain).toBe('multi');
  });

  it('exposes a sane DEFAULT_INTENT', () => {
    expect(DEFAULT_INTENT).toMatchObject({ domain: 'general' });
  });
});
