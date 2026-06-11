import { useState, useMemo } from 'react';

const COLLAPSED_LINES = 6;

function OutputLog({ outputLog, result }: { outputLog: string; result: string | null }) {
  const [showAll, setShowAll] = useState(false);
  const text = outputLog || result || '(no output)';
  const lines = useMemo(() => text.split('\n'), [text]);
  const truncated = !showAll && lines.length > COLLAPSED_LINES;
  const displayed = truncated ? lines.slice(-COLLAPSED_LINES).join('\n') : text;

  return (
    <div className="border-t bg-muted/50">
      {truncated && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full px-4 py-1.5 text-left text-xs text-muted-foreground/60 hover:text-muted-foreground"
        >
          Show all {lines.length} lines
        </button>
      )}
      <div
        role="log"
        className="max-h-48 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground"
      >
        {displayed}
      </div>
    </div>
  );
}
import { ChevronDown, ChevronUp, Check, X, Square } from 'lucide-react';
import { approveExecution, rejectExecution, cancelExecution } from '../lib/api.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type ExecutionStatus = 'pending' | 'running' | 'done' | 'error' | 'awaiting_approval';

interface ExecutionCardProps {
  executionId: string;
  tool: string;
  projectName?: string;
  status: ExecutionStatus;
  outputLog: string;
  result: string | null;
  needsApproval: boolean;
  approvalId: string | null;
  action: string | null;
}

const BORDER_COLOR: Record<ExecutionStatus, string> = {
  pending: 'border-l-muted-foreground/20',
  running: 'border-l-blue-400',
  done: 'border-l-green-400',
  error: 'border-l-destructive',
  awaiting_approval: 'border-l-amber-400',
};

const STATUS_DOT: Record<ExecutionStatus, string> = {
  pending: 'bg-foreground/20',
  running: 'bg-success',
  done: 'bg-foreground/30',
  error: 'bg-destructive',
  awaiting_approval: 'bg-warning',
};

const STATUS_LABEL: Record<ExecutionStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  error: 'Error',
  awaiting_approval: 'Approval',
};

export default function ExecutionCard({
  executionId,
  tool,
  projectName,
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
  const [cancelling, setCancelling] = useState(false);

  const dotColor = STATUS_DOT[status] ?? 'bg-foreground/20';
  const label = projectName ? `${tool} · ${projectName}` : tool;

  async function handleApprove() {
    setActing(true);
    try { await approveExecution(executionId); setDecided('approved'); } finally { setActing(false); }
  }

  async function handleReject() {
    setActing(true);
    try { await rejectExecution(executionId); setDecided('rejected'); } finally { setActing(false); }
  }

  async function handleCancel() {
    setCancelling(true);
    try { await cancelExecution(executionId); } finally { setCancelling(false); }
  }

  const isApproval = needsApproval && !decided;

  return (
    <Card className={cn(
      'overflow-hidden rounded-2xl py-0 shadow-xs',
      'border-l-2',
      BORDER_COLOR[status],
      status === 'awaiting_approval' && !decided ? 'ring-2 ring-warning/25' : '',
    )}>
      <div
        role={!isApproval ? 'button' : undefined}
        onClick={!isApproval ? () => setExpanded(e => !e) : undefined}
        className={`flex items-center gap-2.5 px-4 py-3 ${isApproval ? 'cursor-default' : 'cursor-pointer'}`}
      >
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            decided === 'approved' ? 'bg-success' : decided === 'rejected' ? 'bg-destructive' : dotColor
          }`}
        />
        <span className="flex-1 select-none truncate text-sm text-muted-foreground">{label}</span>
        <Badge variant={status === 'error' ? 'destructive' : status === 'awaiting_approval' ? 'outline' : 'secondary'}>
          {decided ?? STATUS_LABEL[status]}
        </Badge>

        {isApproval && (
          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleApprove}
              disabled={acting}
              className="text-success"
            >
              <Check size={14} strokeWidth={2} /> Approve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleReject}
              disabled={acting}
              className="text-muted-foreground"
            >
              <X size={14} strokeWidth={2} /> Reject
            </Button>
          </div>
        )}

        {status === 'running' && !isApproval && (
          <button
            onClick={e => { e.stopPropagation(); handleCancel(); }}
            disabled={cancelling}
            title="Cancel"
            className="ml-1 rounded p-0.5 text-muted-foreground/50 hover:text-destructive disabled:opacity-40"
          >
            <Square size={13} strokeWidth={2} />
          </button>
        )}
        {!isApproval && !decided && (
          <span className="text-muted-foreground/70">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        )}
      </div>

      {/* Output area */}
      {expanded && !isApproval && (
        <OutputLog outputLog={outputLog} result={result} />
      )}
    </Card>
  );
}
