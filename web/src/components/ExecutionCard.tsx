import { useState } from 'react';
import { ChevronDown, ChevronUp, Check, X } from 'lucide-react';
import { approveExecution, rejectExecution } from '../lib/api.js';
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

  const isApproval = needsApproval && !decided;

  return (
    <Card className={cn(
      'overflow-hidden rounded-2xl py-0 shadow-xs',
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

        {!isApproval && !decided && (
          <span className="text-muted-foreground/70">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        )}
      </div>

      {/* Output area */}
      {expanded && !isApproval && (
        <div
          role="log"
          className="max-h-48 overflow-y-auto border-t bg-muted/50 px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground"
        >
          {outputLog || (result ?? '(no output)')}
        </div>
      )}
    </Card>
  );
}
