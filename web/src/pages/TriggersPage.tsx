import { useQuery } from '@tanstack/react-query';
import { getAllTriggers } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { CenteredEmptyState, ContentColumn, PageBody, PageHeader, PageShell, PageLoading } from '@/components/ui/app-layout';
import { DataTable, DataTableBody, DataTableHeader, DataTableRow } from '@/components/ui/data-table';
import type { Trigger } from '../types.js';

export default function TriggersPage() {
  usePageTitle('Triggers');

  const { data: triggers = [], isLoading } = useQuery<Trigger[]>({
    queryKey: ['triggers-global'],
    queryFn: getAllTriggers,
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
          {isLoading ? <PageLoading rows={3} /> : (
            <>
              {triggers.length === 0 ? (
                <CenteredEmptyState title="No triggers yet" description="Triggers created by the agent will appear here." />
              ) : (
                <DataTable>
                  <DataTableHeader className="grid-cols-[minmax(0,1fr)_7rem] sm:grid-cols-[minmax(0,1fr)_10rem_8rem]">
                    <span>Trigger</span>
                    <span className="hidden sm:block">Schedule</span>
                    <span className="justify-self-end">Status</span>
                  </DataTableHeader>
                  <DataTableBody>
                    {triggers.map(t => (
                      <DataTableRow key={t.id} className="grid-cols-[minmax(0,1fr)_7rem] sm:grid-cols-[minmax(0,1fr)_10rem_8rem]">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium capitalize text-foreground">{t.kind}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-faint-fg sm:hidden">{t.schedule_cron ?? 'Manual'}</div>
                        </div>
                        <span className="hidden truncate font-mono text-xs text-muted-foreground sm:block">{t.schedule_cron ?? 'Manual'}</span>
                        <span className="justify-self-end text-xs text-muted-foreground">{t.enabled ? 'Enabled' : 'Paused'}</span>
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </DataTable>
              )}
            </>
          )}
        </ContentColumn>
      </PageBody>
    </PageShell>
  );
}
