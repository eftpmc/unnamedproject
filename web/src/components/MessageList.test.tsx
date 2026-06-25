import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageList from './MessageList.js';
import type { Message } from '../types.js';

Element.prototype.scrollIntoView = vi.fn();

vi.mock('./ExecutionCard.js', () => ({
  default: ({ tool }: { tool: string }) => <div>{tool}</div>,
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

  it('renders assistant markdown tables as tables', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '| File | Size |\n|---|---:|\n| out/video.mp4 | 316 KB |',
        created_at: 1,
      },
    ];

    render(<MessageList messages={messages} executions={{}} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'out/video.mp4' })).toBeInTheDocument();
  });

  it('renders execution cards in the same container as assistant messages', () => {
    const messages: Message[] = [
      { id: 'user-1', role: 'user', content: 'Do the thing', created_at: 1 },
    ];
    const executions = {
      'user-1': [{
        executionId: 'exec-1',
        tool: 'invoke_claude_code',
        status: 'done' as const,
        outputLog: '',
        result: null,
        createdAt: 2,
        needsApproval: false,
        approvalId: null,
        action: null,
      }],
    };

    const { container } = render(<MessageList messages={messages} executions={executions} />);
    // Execution card wrapper should NOT have the inner restrictive div
    // (max-w-[92%] / sm:max-w-[82%])
    const innerConstraint = container.querySelector('[class*="max-w-\\[92"]');
    expect(innerConstraint).toBeNull();
  });

  it('renders user attachments as download controls', () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'See attached',
        created_at: 1,
        attachments: [{
          id: 'att-1',
          filename: 'notes.md',
          mimeType: 'text/markdown',
          sizeBytes: 2048,
          url: '/sessions/sess-1/messages/user-1/attachments/att-1',
          createdAt: 1,
        }],
      },
    ];

    render(<MessageList messages={messages} executions={{}} />);

    expect(screen.getByRole('button', { name: /notes\.md/i })).toHaveAttribute('title', 'Download notes.md');
    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });
});
