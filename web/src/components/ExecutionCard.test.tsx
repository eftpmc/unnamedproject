import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExecutionCard from './ExecutionCard.js';

vi.mock('../lib/api.js', () => ({
  approveExecution: vi.fn().mockResolvedValue(undefined),
  rejectExecution: vi.fn().mockResolvedValue(undefined),
}));

const baseCard = {
  executionId: 'exec-1',
  tool: 'invoke_claude_code',
  workspaceName: 'api',
  status: 'running' as const,
  outputLog: '',
  result: null,
  needsApproval: false,
  approvalId: null,
  action: null,
};

describe('ExecutionCard', () => {
  it('shows tool name collapsed by default', () => {
    render(<ExecutionCard {...baseCard} />);
    expect(screen.getByText(/invoke_claude_code/)).toBeInTheDocument();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
  });

  it('expands output on click', async () => {
    render(<ExecutionCard {...baseCard} outputLog="line one\nline two" />);
    await userEvent.click(screen.getByText(/invoke_claude_code/));
    expect(screen.getByRole('log')).toBeInTheDocument();
  });

  it('shows approve/reject buttons when needsApproval', () => {
    render(<ExecutionCard {...baseCard} status="awaiting_approval" needsApproval={true} approvalId="appr-1" action="git push" />);
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
  });

  it('calls approveExecution on approve click', async () => {
    const { approveExecution } = await import('../lib/api.js');
    render(<ExecutionCard {...baseCard} executionId="exec-2" status="awaiting_approval" needsApproval={true} approvalId="appr-1" action="git push" />);
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(approveExecution).toHaveBeenCalledWith('exec-2');
  });
});
