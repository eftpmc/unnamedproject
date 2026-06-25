import { describe, it, expect } from 'vitest';
import { validateBlock, validateBlocks } from './blocks.js';

describe('validateBlock', () => {
  it('accepts every valid block type', () => {
    const valid = [
      { type: 'text', content: 'hi' },
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'code', language: 'ts', content: 'const x = 1;' },
      { type: 'table', headers: ['A'], rows: [['1']] },
      { type: 'image', url: 'http://x/y.png' },
      { type: 'task-list', tasks: [{ id: 't1', text: 'Do it', done: false }] },
      { type: 'callout', variant: 'info', content: 'hi' },
      { type: 'file-browser' },
      { type: 'chart', chartType: 'line', data: [{ label: 'W1', value: 1 }] },
      { type: 'stat', label: 'Issues', value: '14', trend: { direction: 'down' } },
      { type: 'list', items: ['a', 'b'] },
      { type: 'progress', value: 50, max: 100 },
      { id: 'stable-id', type: 'text', content: 'with id' },
    ];
    for (const block of valid) {
      expect(validateBlock(block)).toBeNull();
    }
  });

  it('rejects an unrecognized block type', () => {
    expect(validateBlock({ type: 'video', url: 'x' })).toMatch(/not a recognized block type/);
  });

  it('rejects a non-object', () => {
    expect(validateBlock('nope')).toMatch(/must be an object/);
    expect(validateBlock(null)).toMatch(/must be an object/);
  });

  it('rejects a heading with an invalid level', () => {
    expect(validateBlock({ type: 'heading', level: 4, text: 'x' })).toMatch(/level must be 1, 2, or 3/);
  });

  it('rejects a chart with malformed data points', () => {
    expect(validateBlock({ type: 'chart', chartType: 'bar', data: [{ label: 'A' }] })).toMatch(/data\[0\]/);
  });

  it('rejects a chart with an invalid chartType', () => {
    expect(validateBlock({ type: 'chart', chartType: 'pie3d', data: [] })).toMatch(/chartType must be one of/);
  });

  it('rejects a stat with an invalid trend direction', () => {
    expect(validateBlock({ type: 'stat', label: 'X', value: '1', trend: { direction: 'sideways' } })).toMatch(/trend\.direction/);
  });

  it('rejects a task-list with a non-boolean done', () => {
    expect(validateBlock({ type: 'task-list', tasks: [{ id: 't1', text: 'x', done: 'yes' }] })).toMatch(/done must be a boolean/);
  });

  it('rejects an id that is not a string', () => {
    expect(validateBlock({ id: 5, type: 'text', content: 'x' })).toMatch(/id must be a string/);
  });
});

describe('validateBlocks', () => {
  it('accepts an empty array', () => {
    expect(validateBlocks([])).toBeNull();
  });

  it('rejects a non-array', () => {
    expect(validateBlocks({})).toMatch(/must be an array/);
  });

  it('reports the index of the first invalid block', () => {
    const blocks = [{ type: 'text', content: 'ok' }, { type: 'heading', level: 9, text: 'bad' }];
    expect(validateBlocks(blocks)).toMatch(/blocks\[1\]\.level/);
  });
});
