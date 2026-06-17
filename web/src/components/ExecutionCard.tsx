import { useState, useMemo } from 'react';
import { Bot, Check, ChevronDown, ChevronUp, Code2, FileText, GitBranch, GitPullRequest, Square, Terminal, X } from 'lucide-react';
import { approveExecution, rejectExecution, cancelExecution } from '../lib/api.js';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';

const COLLAPSED_LINES = 6;

function looksLikeDiff(text: string): boolean {
  return /^@@\s+-\d/m.test(text) || (/^---\s/m.test(text) && /^\+\+\+\s/m.test(text));
}

function DiffView({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="max-h-72 overflow-y-auto px-0 py-2 font-mono text-[12px] leading-relaxed">
      {lines.map((line, i) => {
        let cls = 'block px-3.5 text-muted-foreground/70';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'block px-3.5 bg-success/10 text-success';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'block px-3.5 bg-destructive/10 text-destructive';
        else if (line.startsWith('@@')) cls = 'block px-3.5 text-primary/70';
        else if (line.startsWith('---') || line.startsWith('+++')) cls = 'block px-3.5 text-muted-foreground/50';
        return <span key={i} className={cls}>{line || ' '}</span>;
      })}
    </div>
  );
}

function OutputLog({ outputLog, result }: { outputLog: string; result: string | null }) {
  const [showAll, setShowAll] = useState(false);
  const text = outputLog || result || '(no output)';
  const isDiff = useMemo(() => looksLikeDiff(text), [text]);
  const lines = useMemo(() => text.split('\n'), [text]);
  const truncated = !isDiff && !showAll && lines.length > COLLAPSED_LINES;
  const displayed = truncated ? lines.slice(-COLLAPSED_LINES).join('\n') : text;

  return (
    <div className="border-t border-border-soft bg-muted/20">
      {truncated && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full px-3 py-1.5 text-left text-xs text-muted-foreground/60 hover:text-muted-foreground"
        >
          Show all {lines.length} lines
        </button>
      )}
      {isDiff ? (
        <DiffView text={text} />
      ) : (
        <div
          role="log"
          className="max-h-44 overflow-y-auto px-3.5 py-3 font-mono text-[12px] leading-relaxed text-muted-foreground whitespace-pre-wrap"
        >
          {displayed}
        </div>
      )}
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
  payload?: Record<string, unknown>;
}

function getExecutionHint(payload?: Record<string, unknown>, outputLog?: string): string | null {
  if (payload) {
    const path = payload.path ?? payload.file_path ?? payload.filename ?? payload.target;
    if (typeof path === 'string' && path) {
      const parts = path.split('/').filter(Boolean);
      return parts.slice(-2).join('/');
    }
    const cmd = payload.command ?? payload.cmd ?? payload.script;
    if (typeof cmd === 'string' && cmd) return cmd.length > 56 ? `${cmd.slice(0, 53)}…` : cmd;
    const url = payload.url ?? payload.repo ?? payload.query;
    if (typeof url === 'string' && url) return url.length > 56 ? `${url.slice(0, 53)}…` : url;
  }
  if (outputLog) {
    const first = outputLog.split('\n').find(l => l.trim().length > 3 && l.trim().length < 72);
    if (first) return first.trim();
  }
  return null;
}

const TOOL_ICON: Array<[RegExp, typeof Bot]> = [
  [/claude|codex|mcp/i, Bot],
  [/github/i, GitPullRequest],
  [/git/i, GitBranch],
  [/file|read|write/i, FileText],
  [/project_query|code/i, Code2],
];


function formatToolName(tool: string): string {
  return tool
    .replace(/^invoke_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function getToolIcon(tool: string): typeof Bot {
  return TOOL_ICON.find(([pattern]) => pattern.test(tool))?.[1] ?? Terminal;
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
  payload,
}: ExecutionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null);
  const [acting, setActing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const ToolIcon = getToolIcon(tool);
  const hint = getExecutionHint(payload, outputLog || undefined);

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
    <div className={cn(
      'overflow-hidden rounded-lg border bg-card shadow-sm',
      status === 'awaiting_approval'
        ? 'border-warning/35'
        : 'border-border-soft',
    )}>
      <div
        role={!isApproval ? 'button' : undefined}
        tabIndex={!isApproval ? 0 : undefined}
        aria-expanded={!isApproval ? expanded : undefined}
        onClick={!isApproval ? () => setExpanded(e => !e) : undefined}
        onKeyDown={!isApproval ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(v => !v);
          }
        } : undefined}
        className={`flex items-center gap-2.5 px-3.5 py-3 ${isApproval ? 'cursor-default' : 'cursor-pointer hover:bg-muted/20 transition-colors'}`}
      >
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <ToolIcon size={14} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs font-medium text-foreground">{formatToolName(tool)}</span>
          {(hint ?? projectName) && (
            <span className="truncate text-[11px] text-faint-fg font-mono">{hint ?? projectName}</span>
          )}
        </div>
        <StatusPill status={decided === 'approved' ? 'done' : decided === 'rejected' ? 'error' : status} />

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
            type="button"
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
        <div className="border-t border-warning/20 px-3.5 py-2 text-xs text-muted-foreground">
          Approval requested for <span className="font-medium text-foreground">{action}</span>
        </div>
      )}

      {/* Output area */}
      {expanded && !isApproval && (
        <OutputLog outputLog={outputLog} result={result} />
      )}
    </div>
  );
}
