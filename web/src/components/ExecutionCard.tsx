import { useState, useMemo } from 'react';
import { AlertCircle, Bot, Check, CheckCircle2, ChevronDown, ChevronUp, Clock3, Code2, FileText, GitBranch, GitPullRequest, LoaderCircle, Square, X } from 'lucide-react';
import { approveExecution, rejectExecution, cancelExecution } from '../lib/api.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const COLLAPSED_LINES = 6;

function OutputLog({ outputLog, result }: { outputLog: string; result: string | null }) {
  const [showAll, setShowAll] = useState(false);
  const text = outputLog || result || '(no output)';
  const lines = useMemo(() => text.split('\n'), [text]);
  const truncated = !showAll && lines.length > COLLAPSED_LINES;
  const displayed = truncated ? lines.slice(-COLLAPSED_LINES).join('\n') : text;

  return (
    <div className="border-t border-border/35 bg-muted/15">
      {truncated && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full px-3 py-1.5 text-left text-xs text-muted-foreground/60 hover:text-muted-foreground"
        >
          Show all {lines.length} lines
        </button>
      )}
      <div
        role="log"
        className="max-h-48 overflow-y-auto px-3 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground"
      >
        {displayed}
      </div>
    </div>
  );
}

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

const STATUS_LABEL: Record<ExecutionStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  error: 'Error',
  awaiting_approval: 'Approval',
};

const STATUS_BADGE: Record<ExecutionStatus, string> = {
  pending: 'bg-muted/70 text-muted-foreground border-transparent',
  running: 'bg-blue-500/10 text-blue-700 border-blue-200/70 dark:text-blue-300 dark:border-blue-900',
  done: 'bg-green-500/10 text-green-700 border-green-200/70 dark:text-green-300 dark:border-green-900',
  error: 'bg-destructive/10 text-destructive border-destructive/20',
  awaiting_approval: 'bg-warning/10 text-foreground border-warning/25',
};

const TOOL_ICON: Array<[RegExp, typeof Bot]> = [
  [/claude|codex|mcp/i, Bot],
  [/git/i, GitBranch],
  [/github/i, GitPullRequest],
  [/file|read|write/i, FileText],
  [/project_query|code/i, Code2],
];

const STATUS_ICON: Record<ExecutionStatus, typeof Clock3> = {
  pending: Clock3,
  running: LoaderCircle,
  done: CheckCircle2,
  error: AlertCircle,
  awaiting_approval: Clock3,
};

const STATUS_ICON_CLASS: Record<ExecutionStatus, string> = {
  pending: 'text-muted-foreground/50',
  running: 'text-blue-500 animate-spin',
  done: 'text-success',
  error: 'text-destructive',
  awaiting_approval: 'text-warning',
};

const ICON_BOX_CLASS: Record<ExecutionStatus, string> = {
  pending: 'bg-muted/60 border-border/30',
  running: 'bg-blue-500/10 border-blue-200/50',
  done: 'bg-success/10 border-success/25',
  error: 'bg-destructive/10 border-destructive/20',
  awaiting_approval: 'bg-warning/10 border-warning/25',
};

function formatToolName(tool: string): string {
  return tool
    .replace(/^invoke_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function getToolIcon(tool: string): typeof Bot {
  return TOOL_ICON.find(([pattern]) => pattern.test(tool))?.[1] ?? Clock3;
}

export default function ExecutionCard({
  executionId,
  tool,
  projectName,
  status,
  outputLog,
  result,
  needsApproval,
  approvalId: _approvalId,
  action,
}: ExecutionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null);
  const [acting, setActing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const label = projectName ? `${formatToolName(tool)} · ${projectName}` : formatToolName(tool);
  const ToolIcon = getToolIcon(tool);
  const StatusIcon = decided === 'approved' ? CheckCircle2 : decided === 'rejected' ? AlertCircle : STATUS_ICON[status];

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
      'overflow-hidden rounded-2xl border-border/25 bg-background py-0 shadow-sm ring-1 ring-black/[0.03]',
      status === 'awaiting_approval' && !decided ? 'bg-warning/5' : '',
    )}>
      <div
        role={!isApproval ? 'button' : undefined}
        onClick={!isApproval ? () => setExpanded(e => !e) : undefined}
        className={`flex min-w-0 items-center gap-2.5 px-3 py-2.5 ${isApproval ? 'cursor-default' : 'cursor-pointer hover:bg-muted/20 transition-colors'}`}
      >
        <StatusIcon
          size={13}
          className={cn(
            'shrink-0',
            decided === 'approved' ? 'text-success' : decided === 'rejected' ? 'text-destructive' : STATUS_ICON_CLASS[status],
          )}
        />
        <span
          data-testid="tool-icon-box"
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-lg border',
            decided === 'approved' ? 'bg-success/10 border-success/25' :
            decided === 'rejected' ? 'bg-destructive/10 border-destructive/20' :
            ICON_BOX_CLASS[status],
          )}
        >
          <ToolIcon size={12} className="text-foreground/60" />
        </span>
        <span className="flex-1 select-none truncate text-xs font-medium text-foreground/75">{label}</span>
        <Badge
          variant="outline"
          className={cn('capitalize', decided ? 'bg-muted text-muted-foreground border-transparent' : STATUS_BADGE[status])}
        >
          {decided ?? STATUS_LABEL[status]}
        </Badge>

        {isApproval && (
          <div className="flex shrink-0 gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handleApprove}
              disabled={acting}
              className="h-7 text-xs text-success"
            >
              <Check size={14} strokeWidth={2} /> Approve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReject}
              disabled={acting}
              className="h-7 text-xs text-muted-foreground"
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

      {isApproval && action && (
        <div className="border-t border-warning/20 px-3 py-2 text-xs text-muted-foreground">
          Approval requested for <span className="font-medium text-foreground">{action}</span>
        </div>
      )}

      {/* Output area */}
      {expanded && !isApproval && (
        <OutputLog outputLog={outputLog} result={result} />
      )}
    </Card>
  );
}
