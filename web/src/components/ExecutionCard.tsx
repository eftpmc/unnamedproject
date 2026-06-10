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
    <div className={`card bg-base-300 border ${status === 'awaiting_approval' && !decided ? 'border-[#201a0a]' : 'border-neutral'} rounded-md overflow-hidden text-[11px]`}>
      {/* Header row */}
      <div
        role={!isApproval ? 'button' : undefined}
        onClick={!isApproval ? () => setExpanded(e => !e) : undefined}
        className={`px-2.5 py-1.5 flex items-center gap-1.5 ${isApproval ? 'cursor-default' : 'cursor-pointer'}`}
      >
        <div
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: decided === 'approved' ? '#4ade80' : decided === 'rejected' ? '#ef4444' : dotColor }}
        />
        <span className="text-[#555555] flex-1 select-none">{label}</span>

        {decided && (
          <span className={`text-[9px] ${decided === 'approved' ? 'text-[#4ade80]' : 'text-error'}`}>
            {decided}
          </span>
        )}

        {isApproval && (
          <div className="flex gap-0.5">
            <button
              onClick={handleApprove}
              disabled={acting}
              className="btn btn-xs min-h-0 h-auto py-0.5 px-2 bg-[#0f1f0f] border-[#1a3a1a] text-[#4ade80] text-[9px]"
            >
              Approve
            </button>
            <button
              onClick={handleReject}
              disabled={acting}
              className="btn btn-xs min-h-0 h-auto py-0.5 px-2 bg-base-300 border-neutral-content/20 text-[#555555] text-[9px]"
            >
              Reject
            </button>
          </div>
        )}

        {!isApproval && !decided && (
          <span className="text-[#333333] text-[9px]">{expanded ? '▴' : '▾'}</span>
        )}
      </div>

      {/* Output area */}
      {expanded && !isApproval && (
        <div
          role="log"
          className={`border-t ${status === 'error' ? 'border-[#2a1010]' : 'border-neutral'} px-2.5 py-1.5 font-mono text-[9px] text-[#555555] leading-relaxed bg-base-200 whitespace-pre-wrap max-h-50 overflow-y-auto`}
        >
          {outputLog || (result ?? '(no output)')}
        </div>
      )}
    </div>
  );
}
