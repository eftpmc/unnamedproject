import { useState } from 'react';
import { approveExecution, rejectExecution } from '../lib/api.js';

type ExecutionStatus = 'pending' | 'running' | 'done' | 'error' | 'awaiting_approval';

interface ExecutionCardProps {
  executionId: string;
  tool: string;
  workspaceName?: string;
  status: ExecutionStatus;
  outputLog: string;
  result: string | null;
  needsApproval: boolean;
  approvalId: string | null;
  action: string | null;
}

const STATUS_DOT: Record<ExecutionStatus, string> = {
  pending: '#333333',
  running: '#22c55e',
  done: '#444444',
  error: '#ef4444',
  awaiting_approval: '#f59e0b',
};

export default function ExecutionCard({
  executionId,
  tool,
  workspaceName,
  status,
  outputLog,
  result,
  needsApproval,
  approvalId: _approvalId,
  action: _action,
}: ExecutionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null);
  const [acting, setActing] = useState(false);

  const dotColor = STATUS_DOT[status] ?? '#333333';
  const label = workspaceName ? `${tool} · ${workspaceName}` : tool;

  async function handleApprove() {
    setActing(true);
    try { await approveExecution(executionId); setDecided('approved'); } finally { setActing(false); }
  }

  async function handleReject() {
    setActing(true);
    try { await rejectExecution(executionId); setDecided('rejected'); } finally { setActing(false); }
  }

  const isApproval = needsApproval && !decided;

  return (
    <div style={{
      background: '#111111',
      border: `1px solid ${status === 'awaiting_approval' && !decided ? '#201a0a' : '#1e1e1e'}`,
      borderRadius: 5,
      overflow: 'hidden',
      fontSize: 11,
    }}>
      {/* Header row */}
      <div
        role={!isApproval ? 'button' : undefined}
        onClick={!isApproval ? () => setExpanded(e => !e) : undefined}
        style={{
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          cursor: isApproval ? 'default' : 'pointer',
        }}
      >
        <div style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: decided === 'approved' ? '#4ade80' : decided === 'rejected' ? '#ef4444' : dotColor,
          flexShrink: 0,
        }} />
        <span style={{ color: '#555555', flex: 1, userSelect: 'none' }}>{label}</span>

        {decided && (
          <span style={{ color: decided === 'approved' ? '#4ade80' : '#ef4444', fontSize: 9 }}>
            {decided}
          </span>
        )}

        {isApproval && (
          <div style={{ display: 'flex', gap: 3 }}>
            <button
              onClick={handleApprove}
              disabled={acting}
              style={{
                background: '#0f1f0f',
                border: '1px solid #1a3a1a',
                borderRadius: 3,
                padding: '2px 8px',
                fontSize: 9,
                color: '#4ade80',
                cursor: acting ? 'not-allowed' : 'pointer',
              }}
            >
              Approve
            </button>
            <button
              onClick={handleReject}
              disabled={acting}
              style={{
                background: '#111',
                border: '1px solid #222',
                borderRadius: 3,
                padding: '2px 8px',
                fontSize: 9,
                color: '#555555',
                cursor: acting ? 'not-allowed' : 'pointer',
              }}
            >
              Reject
            </button>
          </div>
        )}

        {!isApproval && !decided && (
          <span style={{ color: '#333', fontSize: 9 }}>{expanded ? '▴' : '▾'}</span>
        )}
      </div>

      {/* Output area */}
      {expanded && !isApproval && (
        <div
          role="log"
          style={{
            borderTop: `1px solid ${status === 'error' ? '#2a1010' : '#1a1a1a'}`,
            padding: '7px 10px',
            fontFamily: 'monospace',
            fontSize: 9,
            color: '#555555',
            lineHeight: 1.6,
            background: '#0d0d0d',
            whiteSpace: 'pre-wrap',
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          {outputLog || (result ?? '(no output)')}
        </div>
      )}
    </div>
  );
}
