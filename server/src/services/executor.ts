import { createSessionEvent, getDb, getExpoPushToken, setExpoPushToken, getApnsDeviceToken, setApnsDeviceToken } from '../db/index.js';
import { sendApprovalPush } from './push.js';
import { newId } from '../lib/ids.js';
import { broadcast } from './socket.js';
import { waitForApproval } from '../lib/approval.js';

function getSessionIdForMessage(messageId: string): string | null {
  const row = getDb()
    .prepare('SELECT session_id as sessionId FROM messages WHERE id = ?')
    .get(messageId) as { sessionId: string } | undefined;
  return row?.sessionId ?? null;
}

function getSessionIdForExecution(executionId: string): string | null {
  const row = getDb()
    .prepare(`
      SELECT m.session_id as sessionId
      FROM executions e
      JOIN messages m ON m.id = e.message_id
      WHERE e.id = ?
    `)
    .get(executionId) as { sessionId: string } | undefined;
  return row?.sessionId ?? null;
}

export function createExecution(
  userId: string,
  messageId: string | null,
  spaceId: string | null,
  tool: string
): string {
  const id = newId();
  getDb()
    .prepare('INSERT INTO executions (id, message_id, space_id, tool, status) VALUES (?,?,?,?,?)')
    .run(id, messageId, spaceId, tool, 'running');
  broadcast(userId, { type: 'execution_update', sessionId: messageId ? getSessionIdForMessage(messageId) : null, executionId: id, status: 'running', tool, messageId });
  return id;
}

export function appendOutput(executionId: string, userId: string, chunk: string): void {
  getDb()
    .prepare('UPDATE executions SET output_log = output_log || ? WHERE id = ?')
    .run(chunk, executionId);
  broadcast(userId, { type: 'execution_update', sessionId: getSessionIdForExecution(executionId), executionId, chunk });
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
  broadcast(userId, { type: 'execution_update', sessionId: getSessionIdForExecution(executionId), executionId, status, result });
}

export async function requestApproval(
  executionId: string,
  userId: string,
  action: string,
  payload: Record<string, unknown>,
  tier: 'agent' | 'user' = 'user'
): Promise<'approved' | 'rejected'> {
  const approvalId = newId();
  getDb()
    .prepare('INSERT INTO approvals (id, execution_id, action, payload) VALUES (?,?,?,?)')
    .run(approvalId, executionId, action, JSON.stringify(payload));

  if (tier === 'agent') {
    getDb()
      .prepare("UPDATE approvals SET status = 'approved', resolved_at = unixepoch() WHERE id = ?")
      .run(approvalId);
    broadcast(userId, { type: 'action_auto_approved', sessionId: getSessionIdForExecution(executionId), executionId, approvalId, action, payload });
    return 'approved';
  }

  const executionContext = getDb()
    .prepare(`
      SELECT m.session_id AS sessionId, e.space_id AS spaceId
      FROM executions e
      JOIN messages m ON m.id = e.message_id
      WHERE e.id = ?
    `)
    .get(executionId) as { sessionId: string; spaceId: string | null } | undefined;

  // Fall back to session_id from payload for tools that run without a message context
  const sessionId = executionContext?.sessionId ?? (typeof payload.session_id === 'string' ? payload.session_id : null);

  getDb()
    .prepare("UPDATE executions SET status = 'awaiting_approval' WHERE id = ?")
    .run(executionId);
  if (sessionId) {
    const event = createSessionEvent({
      sessionId,
      type: 'approval_requested',
      title: `Approval needed: ${action}`,
      body: 'The agent is waiting for your decision.',
      spaceId: executionContext?.spaceId ?? null,
      executionId,
      metadata: { action, payload },
    });
    broadcast(userId, {
      type: 'session_event_created',
      sessionId,
      event: { ...event, metadata: JSON.parse(event.metadata || '{}') },
    });
  }
  broadcast(userId, { type: 'approval_requested', sessionId, executionId, approvalId, action, payload });
  const expoToken = getExpoPushToken(userId);
  if (expoToken) {
    fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: expoToken,
        title: 'Action needed',
        body: `${action} is waiting for your approval`,
        data: { sessionId: executionContext?.sessionId ?? null, executionId, approvalId },
        sound: 'default',
        priority: 'high',
      }),
    }).then(async r => {
      const json = await r.json() as { data?: Array<{ status: string; message?: string }> };
      const ticket = json.data?.[0];
      if (ticket?.status === 'error' && ticket.message === 'DeviceNotRegistered') {
        setExpoPushToken(userId, null);
      }
    }).catch(err => console.error('[push] Failed to send Expo notification:', err));
  }
  const apnsToken = getApnsDeviceToken(userId);
  if (apnsToken) {
    sendApprovalPush(apnsToken, {
      sessionId: executionContext?.sessionId ?? null,
      executionId,
      approvalId,
      action,
    }).catch(err => {
      if (err instanceof Error && err.message === 'DeviceNotRegistered') {
        setApnsDeviceToken(userId, null);
      } else {
        console.error('[apns] Failed to send notification:', err);
      }
    });
  }
  const decision = await waitForApproval(approvalId);
  getDb()
    .prepare('UPDATE approvals SET status = ?, resolved_at = unixepoch() WHERE id = ?')
    .run(decision, approvalId);
  if (decision === 'approved') {
    getDb()
      .prepare("UPDATE executions SET status = 'running' WHERE id = ?")
      .run(executionId);
    broadcast(userId, {
      type: 'execution_update',
      sessionId: executionContext?.sessionId ?? null,
      executionId,
      status: 'running',
    });
  } else {
    getDb()
      .prepare("UPDATE executions SET status = 'error', completed_at = unixepoch() WHERE id = ?")
      .run(executionId);
    broadcast(userId, {
      type: 'execution_update',
      sessionId: executionContext?.sessionId ?? null,
      executionId,
      status: 'error',
    });
  }
  if (executionContext) {
    const event = createSessionEvent({
      sessionId: executionContext.sessionId,
      type: 'approval_resolved',
      title: decision === 'approved' ? `Approved: ${action}` : `Denied: ${action}`,
      body: decision === 'approved' ? 'The agent can continue.' : 'The agent action was denied.',
      spaceId: executionContext.spaceId,
      executionId,
      metadata: { action, decision },
    });
    broadcast(userId, {
      type: 'session_event_created',
      sessionId: executionContext.sessionId,
      event: { ...event, metadata: JSON.parse(event.metadata || '{}') },
    });
  }
  return decision;
}
