import { EventEmitter } from 'events';

const emitter = new EventEmitter();

export function waitForApproval(approvalId: string): Promise<'approved' | 'rejected'> {
  return new Promise(resolve => {
    emitter.once(`approval:${approvalId}`, resolve);
  });
}

export function resolveApproval(approvalId: string, decision: 'approved' | 'rejected'): void {
  emitter.emit(`approval:${approvalId}`, decision);
}
