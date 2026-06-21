import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import { getPendingApprovals, approveExecution, rejectExecution } from '../lib/api.js';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingApprovals: Map<string, string>;
  onApprovalResolved: (executionId: string) => void;
}

function formatPayload(payload: Record<string, unknown>): { summary: string; detail: string | null } {
  const path = (payload.path ?? payload.file_path ?? payload.filePath) as string | undefined;
  const command = (payload.command ?? payload.cmd) as string | undefined;
  const content = payload.content as string | undefined;
  const description = payload.description as string | undefined;

  if (path && content !== undefined) {
    const lines = content.split('\n').length;
    return { summary: path, detail: `${lines} line${lines !== 1 ? 's' : ''}` };
  }
  if (command) {
    return { summary: command, detail: null };
  }
  if (path) {
    return { summary: path, detail: null };
  }
  if (description) {
    return { summary: description, detail: null };
  }
  const keys = Object.keys(payload).filter(k => typeof payload[k] === 'string');
  if (keys.length > 0) {
    return { summary: String(payload[keys[0]]), detail: null };
  }
  return { summary: JSON.stringify(payload), detail: null };
}

function ApprovalCard({
  executionId,
  action,
  payload,
  onResolve,
}: {
  executionId: string;
  action: string;
  payload?: Record<string, unknown>;
  onResolve: (executionId: string, decision: 'approved' | 'rejected') => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState(false);
  const formatted = payload && Object.keys(payload).length > 0 ? formatPayload(payload) : null;
  const hasRawDetail = payload && Object.keys(payload).length > 0;

  async function handleResolve(decision: 'approved' | 'rejected') {
    setActing(true);
    try { onResolve(executionId, decision); } finally { setActing(false); }
  }

  return (
    <li className="flex flex-col rounded-xl border border-warning/30 bg-warning/[0.06]">
      <div className="flex items-start gap-3 p-4">
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-warning/15 text-warning">
          <Bell size={13} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground leading-snug">{action}</p>
          {formatted && (
            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
              {formatted.summary}
              {formatted.detail && <span className="ml-1.5 text-faint-fg">· {formatted.detail}</span>}
            </p>
          )}
        </div>
        {hasRawDetail && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="shrink-0 text-muted-foreground/50 hover:text-muted-foreground"
            title={expanded ? 'Hide details' : 'Show details'}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>

      {expanded && payload && (
        <div className="border-t border-warning/15 px-4 pb-3 pt-2">
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      )}

      <div className="flex gap-2 border-t border-warning/15 px-4 pb-4 pt-3">
        <button
          type="button"
          onClick={() => void handleResolve('approved')}
          disabled={acting}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-[filter] hover:brightness-105 disabled:opacity-60"
        >
          <Check size={12} strokeWidth={2.5} />
          Approve
        </button>
        <button
          type="button"
          onClick={() => void handleResolve('rejected')}
          disabled={acting}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-60"
        >
          <X size={12} strokeWidth={2.5} />
          Deny
        </button>
      </div>
    </li>
  );
}

export default function InboxPanel({ open, onOpenChange, pendingApprovals, onApprovalResolved }: Props) {
  const { data: storedApprovals = [] } = useQuery({
    queryKey: ['pending-approvals'],
    queryFn: getPendingApprovals,
    staleTime: 15_000,
    refetchInterval: open ? 10_000 : false,
  });

  async function handleResolve(executionId: string, decision: 'approved' | 'rejected') {
    if (decision === 'approved') await approveExecution(executionId);
    else await rejectExecution(executionId);
    onApprovalResolved(executionId);
  }

  const isEmpty = storedApprovals.length === 0 && pendingApprovals.size === 0;

  const allApprovals: Array<{ execution_id: string; action: string; payload?: Record<string, unknown> }> = [
    ...storedApprovals.map(a => ({ execution_id: a.execution_id, action: a.action, payload: a.payload })),
    ...[...pendingApprovals.entries()]
      .filter(([execId]) => !storedApprovals.some(a => a.execution_id === execId))
      .map(([execId]) => ({ execution_id: execId, action: 'Awaiting approval', payload: undefined })),
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2">
            <Bell size={15} strokeWidth={1.75} className="text-muted-foreground" />
            Inbox
          </SheetTitle>
          <SheetDescription className="sr-only">Pending approvals and agent requests requiring action</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <div className="grid size-10 place-items-center rounded-full bg-muted">
                <Check size={18} strokeWidth={2} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">All clear</p>
              <p className="text-xs text-muted-foreground">Approvals and agent requests will appear here.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2 p-4">
              {allApprovals.map(approval => (
                <ApprovalCard
                  key={approval.execution_id}
                  executionId={approval.execution_id}
                  action={approval.action}
                  payload={approval.payload}
                  onResolve={handleResolve}
                />
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
