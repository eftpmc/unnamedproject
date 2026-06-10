import { useState } from 'react';
import { ChevronDown, ChevronUp, Check, X } from 'lucide-react';
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
  pending: 'bg-base-content/20',
  running: 'bg-success',
  done: 'bg-base-content/30',
  error: 'bg-error',
  awaiting_approval: 'bg-warning',
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

  const dotColor = STATUS_DOT[status] ?? 'bg-base-content/20';
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
    <div className={`card bg-base-300 ${status === 'awaiting_approval' && !decided ? 'ring-1 ring-warning/30' : ''} rounded-2xl overflow-hidden text-sm`}>
      {/* Header row */}
      <div
        role={!isApproval ? 'button' : undefined}
        onClick={!isApproval ? () => setExpanded(e => !e) : undefined}
        className={`px-4 py-3 flex items-center gap-2.5 ${isApproval ? 'cursor-default' : 'cursor-pointer'}`}
      >
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            decided === 'approved' ? 'bg-success' : decided === 'rejected' ? 'bg-error' : dotColor
          }`}
        />
        <span className="text-base-content/60 flex-1 select-none">{label}</span>

        {decided && (
          <span className={`text-xs ${decided === 'approved' ? 'text-success' : 'text-error'}`}>
            {decided}
          </span>
        )}

        {isApproval && (
          <div className="flex gap-1.5">
            <button
              onClick={handleApprove}
              disabled={acting}
              className="btn btn-sm rounded-full bg-success/10 border-none text-success hover:bg-success/20"
            >
              <Check size={14} strokeWidth={2} /> Approve
            </button>
            <button
              onClick={handleReject}
              disabled={acting}
              className="btn btn-sm rounded-full bg-base-200 border-none text-base-content/50 hover:bg-base-200/70"
            >
              <X size={14} strokeWidth={2} /> Reject
            </button>
          </div>
        )}

        {!isApproval && !decided && (
          <span className="text-base-content/30">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        )}
      </div>

      {/* Output area */}
      {expanded && !isApproval && (
        <div
          role="log"
          className="border-t border-base-200 px-4 py-3 font-mono text-xs text-base-content/50 leading-relaxed bg-base-200 whitespace-pre-wrap max-h-50 overflow-y-auto"
        >
          {outputLog || (result ?? '(no output)')}
        </div>
      )}
    </div>
  );
}
