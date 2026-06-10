import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { broadcast } from './socket.js';
import { waitForApproval } from '../lib/approval.js';

export function createExecution(
  userId: string,
  messageId: string,
  workspaceId: string,
  tool: string
): string {
  const id = newId();
  getDb()
    .prepare('INSERT INTO executions (id, message_id, workspace_id, tool, status) VALUES (?,?,?,?,?)')
    .run(id, messageId, workspaceId, tool, 'running');
  broadcast(userId, { type: 'execution_update', executionId: id, status: 'running', tool });
  return id;
}

export function appendOutput(executionId: string, userId: string, chunk: string): void {
  getDb()
    .prepare('UPDATE executions SET output_log = output_log || ? WHERE id = ?')
    .run(chunk, executionId);
  broadcast(userId, { type: 'execution_update', executionId, chunk });
}

export function completeExecution(
  executionId: string,
  userId: string,
  status: 'done' | 'error',
  result: string
): void {
  getDb()
    .prepare('UPDATE executions SET status = ?, result = ?, completed_at = unixepoch() WHERE id = ?')
    .run(status, result, executionId);
  broadcast(userId, { type: 'execution_update', executionId, status, result });
}

export async function requestApproval(
  executionId: string,
  userId: string,
  action: string,
  payload: Record<string, unknown>
): Promise<'approved' | 'rejected'> {
  const approvalId = newId();
  getDb()
    .prepare('INSERT INTO approvals (id, execution_id, action, payload) VALUES (?,?,?,?)')
    .run(approvalId, executionId, action, JSON.stringify(payload));
  getDb()
    .prepare("UPDATE executions SET status = 'awaiting_approval' WHERE id = ?")
    .run(executionId);
  broadcast(userId, {
    type: 'approval_requested',
    executionId,
    approvalId,
    action,
    payload,
  });
  const decision = await waitForApproval(approvalId);
  getDb()
    .prepare('UPDATE approvals SET status = ?, resolved_at = unixepoch() WHERE id = ?')
    .run(decision, approvalId);
  if (decision === 'approved') {
    getDb()
      .prepare("UPDATE executions SET status = 'running' WHERE id = ?")
      .run(executionId);
  }
  broadcast(userId, {
    type: 'execution_update',
    executionId,
    status: decision === 'approved' ? 'running' : 'rejected',
  });
  return decision;
}
