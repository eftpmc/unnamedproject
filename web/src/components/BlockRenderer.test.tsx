import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BlockRenderer from './BlockRenderer.js';
import type { Block } from '../types.js';

vi.mock('../lib/api.js', () => ({ updateItemTask: vi.fn() }));

describe('BlockRenderer', () => {
  it('renders a valid text block', () => {
    render(<BlockRenderer block={{ type: 'text', content: 'hello world' }} spaceId="s1" itemId="i1" />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('isolates a block render failure to that block only, leaving siblings intact', () => {
    const goodBlock: Block = { type: 'text', content: 'I am fine' };
    // `rows` should be string[][] — passing a string makes TableBlock's
    // `.map` throw, simulating a block that slipped past server validation
    // or was hand-edited into a bad shape.
    const badBlock = { type: 'table', headers: ['A'], rows: 'not-an-array' } as unknown as Block;

    render(
      <>
        <BlockRenderer block={goodBlock} spaceId="s1" itemId="i1" />
        <BlockRenderer block={badBlock} spaceId="s1" itemId="i1" />
      </>,
    );

    expect(screen.getByText('I am fine')).toBeInTheDocument();
    expect(screen.getByText('This block failed to render.')).toBeInTheDocument();
  });
});
