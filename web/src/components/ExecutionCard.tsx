import { useMemo, useState } from 'react';
import { Bot, Check, ChevronDown, ChevronUp, Code2, Copy, FileText, GitBranch, GitPullRequest, Square, Terminal } from 'lucide-react';
import { cancelExecution } from '../lib/api.js';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import { ApprovalCard } from './ApprovalCards.js';
import type { ApprovalUI } from '../types.js';

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
    <div className="border-t border-border-soft bg-muted/10">
      {truncated && (
        <button type="button" onClick={() => setShowAll(true)} className="w-full px-3 py-1.5 text-left text-xs text-muted-foreground/60 hover:text-muted-foreground">
          Show all {lines.length} lines
        </button>
      )}
      {isDiff ? (
        <DiffView text={text} />
      ) : (
        <div role="log" className="max-h-44 overflow-y-auto px-3.5 py-3 font-mono text-[12px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {displayed}
        </div>
      )}
    </div>
  );
}

function CopyResultButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="shrink-0 text-muted-foreground/40 transition-opacity hover:text-muted-foreground"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
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

function getHint(payload?: Record<string, unknown>, outputLog?: string): string | null {
  if (payload) {
    const path = payload.path ?? payload.file_path ?? payload.filename ?? payload.target;
    if (typeof path === 'string' && path) return path.split('/').filter(Boolean).slice(-2).join('/');
    const cmd = payload.command ?? payload.cmd;
    if (typeof cmd === 'string' && cmd) return cmd.length > 64 ? `${cmd.slice(0, 61)}…` : cmd;
    const url = payload.url ?? payload.repo ?? payload.query;
    if (typeof url === 'string' && url) return url.length > 64 ? `${url.slice(0, 61)}…` : url;
  }
  if (outputLog) {
    const first = outputLog.split('\n').find(l => l.trim().length > 3 && l.trim().length < 72);
    if (first) return first.trim();
  }
  return null;
}

const TOOL_ICON: Array<[RegExp, typeof Bot]> = [
  [/claude|mcp/i, Bot],
  [/github/i, GitPullRequest],
  [/git/i, GitBranch],
  [/file|read|write/i, FileText],
  [/project_query|code/i, Code2],
];

function getToolIcon(tool: string): typeof Bot {
  return TOOL_ICON.find(([p]) => p.test(tool))?.[1] ?? Terminal;
}

function formatTool(tool: string): string {
  return tool.replace(/^invoke_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function ExecutionCard({ executionId, tool, projectName, status, outputLog, result, needsApproval, action, payload }: ExecutionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [decided, setDecided] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const ToolIcon = getToolIcon(tool);
  const hint = getHint(payload, outputLog || undefined);
  const ui = payload?.ui as ApprovalUI | undefined;
  const isApproval = needsApproval && !decided;

  async function handleCancel() {
    setCancelling(true);
    try { await cancelExecution(executionId); } finally { setCancelling(false); }
  }

  // ── Approval state: full card, no header chrome ──────────────────────────
  if (isApproval) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border-soft bg-card shadow-sm">
        <ApprovalCard
          ui={ui}
          action={action}
          executionId={executionId}
          onDone={() => setDecided(true)}
        />
      </div>
    );
  }

  // ── Post-decision: show a quiet resolved pill ────────────────────────────
  if (decided) {
    return null;
  }

  // ── Normal execution: minimal collapsible row ────────────────────────────
  const hasOutput = !!(outputLog || result);

  return (
    <div className={cn(
      'overflow-hidden rounded-xl border bg-card',
      status === 'error' ? 'border-destructive/25' : 'border-border-soft',
    )}>
      <button
        type="button"
        onClick={() => hasOutput && setExpanded(e => !e)}
        className={cn(
          'flex w-full items-center gap-2.5 px-3 py-2.5 text-left',
          hasOutput ? 'cursor-pointer hover:bg-muted/15 transition-colors' : 'cursor-default',
        )}
      >
        <div className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted/60 text-muted-foreground/70">
          <ToolIcon size={12} />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-[11.5px] font-medium text-muted-foreground">{formatTool(tool)}</span>
          {(hint ?? projectName) && (
            <span className="truncate text-[11px] text-faint-fg font-mono">{hint ?? projectName}</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {result && !expanded && <CopyResultButton text={result} />}
          <StatusPill status={status} />
          {status === 'running' && (
            <button type="button" onClick={e => { e.stopPropagation(); handleCancel(); }} disabled={cancelling} title="Cancel"
              className="rounded p-0.5 text-muted-foreground/40 hover:text-destructive disabled:opacity-40">
              <Square size={11} strokeWidth={2} />
            </button>
          )}
          {hasOutput && (
            <span className="text-muted-foreground/40">
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </span>
          )}
        </div>
      </button>

      {expanded && hasOutput && <OutputLog outputLog={outputLog} result={result} />}
    </div>
  );
}
