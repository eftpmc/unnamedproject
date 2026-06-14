import { EventEmitter } from 'events';

const emitter = new EventEmitter();

const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export function waitForApproval(approvalId: string): Promise<'approved' | 'rejected'> {
  return new Promise((resolve, reject) => {
    const listener = (decision: 'approved' | 'rejected') => {
      clearTimeout(timer);
      resolve(decision);
    };
    const timer = setTimeout(() => {
      emitter.off(`approval:${approvalId}`, listener);
      resolve('rejected');
    }, APPROVAL_TIMEOUT_MS);
    emitter.once(`approval:${approvalId}`, listener);
  });
}

export function resolveApproval(approvalId: string, decision: 'approved' | 'rejected'): void {
  emitter.emit(`approval:${approvalId}`, decision);
}
