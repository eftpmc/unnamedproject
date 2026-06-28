import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { getAllTriggers, updateGlobalTrigger, deleteGlobalTrigger } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { timeAgo } from '../lib/utils.js';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CenteredEmptyState, ContentColumn, PageBody, PageHeader, PageShell, PageLoading } from '@/components/ui/app-layout';
import { DataTable, DataTableBody, DataTableHeader, DataTableRow } from '@/components/ui/data-table';
import type { Trigger } from '../types.js';

export default function TriggersPage() {
  usePageTitle('Triggers');
  const qc = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<Trigger | null>(null);

  const { data: triggers = [], isLoading } = useQuery<Trigger[]>({
    queryKey: ['triggers-global'],
    queryFn: getAllTriggers,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateGlobalTrigger(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['triggers-global'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteGlobalTrigger(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['triggers-global'] }); setPendingDelete(null); },
    onError: () => setPendingDelete(null),
  });

  return (
    <PageShell>
      <PageHeader
        title="Triggers"
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
      />
      <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
        <ContentColumn className="max-w-7xl">
          {isLoading ? <PageLoading rows={3} /> : triggers.length === 0 ? (
            <CenteredEmptyState title="No triggers yet" description="Triggers created by the agent will appear here." />
          ) : (
            <DataTable>
              <DataTableHeader className="grid-cols-[minmax(0,1fr)_7rem_4rem_1.75rem] sm:grid-cols-[minmax(0,1fr)_12rem_4rem_5rem_1.75rem]">
                <span>Trigger</span>
                <span className="hidden sm:block">Schedule</span>
                <span className="justify-self-end">Enabled</span>
                <span className="hidden justify-self-end sm:block">Last run</span>
                <span />
              </DataTableHeader>
              <DataTableBody>
                {triggers.map(t => {
                  const enabled = !!t.enabled;
                  return (
                    <DataTableRow key={t.id} className="grid-cols-[minmax(0,1fr)_7rem_4rem_1.75rem] sm:grid-cols-[minmax(0,1fr)_12rem_4rem_5rem_1.75rem]">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium capitalize text-foreground">{t.kind}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-faint-fg sm:hidden">{t.schedule_cron ?? 'Manual'}</div>
                      </div>
                      <span className="hidden truncate font-mono text-xs text-muted-foreground sm:block">{t.schedule_cron ?? 'Manual'}</span>
                      <div className="justify-self-end">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          disabled={toggleMutation.isPending}
                          onClick={() => toggleMutation.mutate({ id: t.id, enabled: !enabled })}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${enabled ? 'bg-primary' : 'bg-muted'}`}
                        >
                          <span className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>
                      <span className="hidden justify-self-end whitespace-nowrap text-[11px] text-faint-fg sm:block">
                        {t.last_run_at ? timeAgo(t.last_run_at) : 'Never'}
                      </span>
                      <button
                        type="button"
                        aria-label="Delete trigger"
                        onClick={() => setPendingDelete(t)}
                        className="grid size-7 place-items-center justify-self-end rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
                      >
                        <Trash2 size={13} />
                      </button>
                    </DataTableRow>
                  );
                })}
              </DataTableBody>
            </DataTable>
          )}
        </ContentColumn>
      </PageBody>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete trigger?"
          description="This will permanently remove the trigger. Any scheduled runs will stop."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </PageShell>
  );
}
