import { X, GitMerge, Check, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Project } from '../types.js';

interface Approval {
  executionId: string;
  approvalId: string;
  action: string;
}

interface ContextPanelProps {
  open: boolean;
  onClose: () => void;
  project: Project | null;
  worktree: { branch: string; commits_ahead: number } | null;
  pendingApproval: Approval | null;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
  onMerge: () => void;
  mergeState: 'idle' | 'merging' | 'done' | 'error';
}

export default function ContextPanel({
  open,
  onClose,
  project,
  worktree,
  pendingApproval,
  onApprove,
  onDeny,
  onMerge,
  mergeState,
}: ContextPanelProps) {
  return (
    <>
      {/* Desktop: slide-in right panel */}
      <aside
        className={cn(
          'hidden shrink-0 overflow-hidden border-l border-border-soft bg-muted transition-[width] duration-300 ease-in-out md:block',
          open ? 'w-72' : 'w-0 border-l-transparent',
        )}
      >
        <div className="w-72 overflow-y-auto h-full">
          <PanelContent
            onClose={onClose}
            project={project}
            worktree={worktree}
            pendingApproval={pendingApproval}
            onApprove={onApprove}
            onDeny={onDeny}
            onMerge={onMerge}
            mergeState={mergeState}
          />
        </div>
      </aside>

      {/* Mobile: bottom sheet */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={onClose}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-background shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="mx-auto mt-2 h-1 w-8 rounded-full bg-border" />
            <PanelContent
              onClose={onClose}
              project={project}
              worktree={worktree}
              pendingApproval={pendingApproval}
              onApprove={onApprove}
              onDeny={onDeny}
              onMerge={onMerge}
              mergeState={mergeState}
            />
          </div>
        </div>
      )}
    </>
  );
}

function PanelContent({
  onClose,
  project,
  worktree,
  pendingApproval,
  onApprove,
  onDeny,
  onMerge,
  mergeState,
}: Omit<ContextPanelProps, 'open'>) {
  return (
    <div className="flex flex-col gap-5 p-4 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Context</span>
        <button
          type="button"
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>

      {/* Project */}
      {project && (
        <section className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Project</span>
          <div className="flex items-center gap-2.5 rounded-xl border border-border-soft bg-card p-3">
            <span className="size-2 shrink-0 rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_oklch,var(--success)_22%,transparent)]" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{project.name}</div>
              <div className="text-[11px] text-faint-fg">{project.description ?? (project.repo_path ? 'code repo' : 'doc project')}</div>
            </div>
          </div>
        </section>
      )}

      {/* Branch */}
      {worktree && (
        <section className="flex flex-col gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">Working branch</span>
          <div className="flex items-center gap-2 text-sm">
            <GitMerge size={13} className="shrink-0 text-muted-foreground" />
            <code className="font-mono text-xs text-fg-soft">{worktree.branch}</code>
          </div>
          <div className="text-[11px] text-faint-fg">
            {worktree.commits_ahead} commit{worktree.commits_ahead !== 1 ? 's' : ''} ahead
          </div>
          <button
            type="button"
            onClick={onMerge}
            disabled={mergeState === 'merging' || mergeState === 'done'}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-[filter] hover:enabled:brightness-105 disabled:opacity-60"
          >
            {mergeState === 'merging' ? 'Merging…' : mergeState === 'done' ? 'Merged ✓' : 'Merge to main'}
          </button>
          {mergeState === 'error' && (
            <p className="text-[11px] text-destructive">Merge failed — check branch status.</p>
          )}
        </section>
      )}

      {/* Pending approval */}
      {pendingApproval && (
        <section className="flex flex-col gap-2 rounded-xl border border-warning/35 bg-warning/5 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-warning">
            <Bell size={12} />
            Needs approval
          </div>
          <div className="text-sm font-semibold text-foreground">{pendingApproval.action}</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onDeny(pendingApproval.approvalId)}
              className="flex-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Deny
            </button>
            <button
              type="button"
              onClick={() => onApprove(pendingApproval.approvalId)}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-[filter] hover:brightness-105"
            >
              <Check size={11} strokeWidth={2.5} />
              Approve
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
