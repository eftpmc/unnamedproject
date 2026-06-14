import * as React from 'react';
import { AlertCircle, Bell, Check, Circle, Clock, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PillStatus =
  | 'running'
  | 'done'
  | 'error'
  | 'awaiting_approval'
  | 'pending'
  | 'cancelled'
  | 'ready'
  | 'review';

const CONFIG: Record<PillStatus, { label: string; className: string; icon: React.ReactNode }> = {
  running: {
    label: 'Running',
    className: 'bg-primary/15 text-on-accent-soft',
    icon: <LoaderCircle size={11} className="animate-spin" />,
  },
  done: {
    label: 'Done',
    className: 'bg-success/15 text-success',
    icon: <Check size={11} strokeWidth={2.4} />,
  },
  error: {
    label: 'Error',
    className: 'bg-destructive/12 text-destructive',
    icon: <AlertCircle size={11} />,
  },
  awaiting_approval: {
    label: 'Needs approval',
    className: 'bg-warning/18 text-warning',
    icon: <Bell size={11} />,
  },
  pending: {
    label: 'Pending',
    className: 'bg-muted text-muted-foreground',
    icon: <Circle size={9} />,
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-muted text-muted-foreground',
    icon: <Circle size={9} />,
  },
  ready: {
    label: 'Ready',
    className: 'bg-success/15 text-success',
    icon: <Check size={11} strokeWidth={2.4} />,
  },
  review: {
    label: 'In review',
    className: 'bg-warning/18 text-warning',
    icon: <Clock size={11} />,
  },
};

/** Slate status pill — matches the reference `.status` chips (done / running / etc.). */
export function StatusPill({ status, className }: { status: PillStatus; className?: string }) {
  const c = CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        c.className,
        className,
      )}
    >
      {c.icon}
      {c.label}
    </span>
  );
}
