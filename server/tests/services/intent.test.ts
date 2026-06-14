import { describe, it, expect } from 'vitest';
import { classifyIntent, DEFAULT_INTENT } from '../../src/services/intent.js';

describe('classifyIntent', () => {
  it('classifies a code task and delegates it', () => {
    const intent = classifyIntent('fix the login bug in the api');
    expect(intent.domain).toBe('code');
    expect(intent.scope).toBe('delegate');
    expect(intent.ambiguous).toBe(false);
    expect(intent.tools).toEqual([]);
  });

  it('classifies a research task and flags needs_research', () => {
    const intent = classifyIntent('explain how photosynthesis works');
    expect(intent.domain).toBe('research');
    expect(intent.needs_research).toBe(true);
    expect(intent.scope).toBe('inline');
  });

  it('classifies a writing task', () => {
    const intent = classifyIntent('draft an email to the team');
    expect(intent.domain).toBe('writing');
    expect(intent.scope).toBe('inline');
    expect(intent.needs_research).toBe(false);
  });

  it('classifies a creative task', () => {
    const intent = classifyIntent('brainstorm names for my startup');
    expect(intent.domain).toBe('creative');
  });

  it('classifies an image task', () => {
    const intent = classifyIntent('generate an image of a sunset');
    expect(intent.domain).toBe('image');
    // image requests are unambiguous even with no other domain signal
    expect(intent.ambiguous).toBe(false);
  });

  it('marks a message with no domain signal as ambiguous general', () => {
    const intent = classifyIntent('hey there');
    expect(intent.domain).toBe('general');
    expect(intent.ambiguous).toBe(true);
  });

  it('escalates complexity and model for high-complexity work', () => {
    const intent = classifyIntent('redesign the entire architecture of the system');
    expect(intent.complexity).toBe('high');
    expect(intent.model).toBe('opus');
  });

  it('picks the haiku model for short low-complexity messages', () => {
    const intent = classifyIntent('draft an email to the team');
    expect(intent.complexity).toBe('low');
    expect(intent.model).toBe('haiku');
  });

  it('routes coordinated work to campaign scope', () => {
    const intent = classifyIntent('run a campaign to launch the product');
    expect(intent.scope).toBe('campaign');
  });

  it('classifies a message with multiple domain signals as multi', () => {
    const intent = classifyIntent('research and implement a caching layer');
    expect(intent.domain).toBe('multi');
    expect(intent.needs_research).toBe(true);
  });

  it('never proposes tools from the heuristic pass', () => {
    expect(classifyIntent('fix the login bug in the api').tools).toEqual([]);
    expect(classifyIntent('write a proposal').tools).toEqual([]);
  });

  it('exposes a sane DEFAULT_INTENT', () => {
    expect(DEFAULT_INTENT).toMatchObject({
      domain: 'general',
      tools: [],
      ambiguous: true,
    });
  });
});
