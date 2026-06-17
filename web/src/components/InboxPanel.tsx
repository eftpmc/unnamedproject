import { useRef, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, X } from 'lucide-react';
import { getPendingApprovals, approveExecution, rejectExecution } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { WSApprovalRequested, WSExecutionUpdate } from '../types.js';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingApprovals: Map<string, string>; // executionId → approvalId
  onApprovalResolved: (executionId: string) => void;
}

export default function InboxPanel({ open, onOpenChange, pendingApprovals, onApprovalResolved }: Props) {
  const { data: storedApprovals = [] } = useQuery({
    queryKey: ['pending-approvals'],
    queryFn: getPendingApprovals,
    staleTime: 15_000,
    refetchInterval: open ? 10_000 : false,
  });

  async function resolve(executionId: string, decision: 'approved' | 'rejected') {
    if (decision === 'approved') {
      await approveExecution(executionId);
    } else {
      await rejectExecution(executionId);
    }
    onApprovalResolved(executionId);
  }

  const isEmpty = storedApprovals.length === 0 && pendingApprovals.size === 0;

  // Merge stored + live approvals, deduplicated by execution_id
  const allApprovals = [
    ...storedApprovals,
    ...[...pendingApprovals.entries()]
      .filter(([execId]) => !storedApprovals.some(a => a.execution_id === execId))
      .map(([execId, approvalId]) => ({ execution_id: execId, id: approvalId, action: 'Awaiting approval' })),
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2">
            <Bell size={15} strokeWidth={1.75} className="text-muted-foreground" />
            Inbox
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <div className="grid size-10 place-items-center rounded-full bg-muted">
                <Check size={18} strokeWidth={2} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">All clear</p>
              <p className="text-xs text-muted-foreground">
                Approvals and agent requests will appear here.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2 p-4">
              {allApprovals.map(approval => (
                <li
                  key={approval.execution_id}
                  className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/[0.06] p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="grid size-7 shrink-0 place-items-center rounded-md bg-warning/15 text-warning">
                      <Bell size={13} strokeWidth={2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground leading-snug">
                        {approval.action}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Waiting for your approval
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void resolve(approval.execution_id, 'approved')}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-[filter] hover:brightness-105"
                    >
                      <Check size={12} strokeWidth={2.5} />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void resolve(approval.execution_id, 'rejected')}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                    >
                      <X size={12} strokeWidth={2.5} />
                      Deny
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
