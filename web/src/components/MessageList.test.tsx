import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageList from './MessageList.js';
import type { Message } from '../types.js';

Element.prototype.scrollIntoView = vi.fn();

vi.mock('./ExecutionCard.js', () => ({
  default: ({ tool }: { tool: string }) => <div>{tool}</div>,
}));

vi.mock('./CampaignCard.js', () => ({
  default: () => <div>Campaign card</div>,
}));

describe('MessageList', () => {
  it('does not render empty assistant messages without executions', () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Do the thing',
        created_at: 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        created_at: 2,
      },
    ];

    const { container } = render(<MessageList messages={messages} executions={{}} />);

    expect(screen.getByText('Do the thing')).toBeInTheDocument();
    expect(container.textContent).toBe('Do the thing');
  });
});
