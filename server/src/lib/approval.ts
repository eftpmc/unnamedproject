import { EventEmitter } from 'events';

const emitter = new EventEmitter();

const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export interface ApprovalResolution {
  decision: 'approved' | 'rejected';
  value?: string;
}

export function waitForApproval(approvalId: string): Promise<ApprovalResolution> {
  return new Promise((resolve) => {
    const listener = (resolution: ApprovalResolution) => {
      clearTimeout(timer);
      resolve(resolution);
    };
    const timer = setTimeout(() => {
      emitter.off(`approval:${approvalId}`, listener);
      resolve({ decision: 'rejected' });
    }, APPROVAL_TIMEOUT_MS);
    emitter.once(`approval:${approvalId}`, listener);
  });
}

export function resolveApproval(approvalId: string, decision: 'approved' | 'rejected', value?: string): void {
  emitter.emit(`approval:${approvalId}`, { decision, value });
}
