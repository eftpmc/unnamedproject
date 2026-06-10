import { describe, it, expect } from 'vitest';
import { waitForApproval, resolveApproval } from '../../src/lib/approval.js';

describe('approval gate', () => {
  it('resolves with approved', async () => {
    const id = 'test-approval-1';
    setTimeout(() => resolveApproval(id, 'approved'), 10);
    const result = await waitForApproval(id);
    expect(result).toBe('approved');
  });

  it('resolves with rejected', async () => {
    const id = 'test-approval-2';
    setTimeout(() => resolveApproval(id, 'rejected'), 10);
    const result = await waitForApproval(id);
    expect(result).toBe('rejected');
  });
});
