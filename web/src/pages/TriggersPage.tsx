import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import { getAllTriggers } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { CenteredEmptyState, ContentColumn, PageBody, PageHeader, PageShell, PageLoading } from '@/components/ui/app-layout';
import type { Trigger } from '../types.js';

export default function TriggersPage() {
  usePageTitle('Triggers');

  const { data: triggers = [], isLoading } = useQuery<Trigger[]>({
    queryKey: ['triggers-global'],
    queryFn: getAllTriggers,
  });

  return (
    <PageShell>
      <PageHeader title="Triggers" className="border-0 pb-0" contentClassName="max-w-5xl" />
      <PageBody>
        <ContentColumn className="max-w-5xl">
          {isLoading ? <PageLoading rows={3} /> : (
            <div className="flex flex-col gap-2">
              {triggers.length === 0 ? (
                <CenteredEmptyState title="No triggers yet" description="Triggers created by the agent will appear here." />
              ) : triggers.map(t => (
                <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3">
                  <Zap size={14} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium capitalize">{t.kind}</span>
                    {t.schedule_cron && <span className="block font-mono text-[11px] text-faint-fg">{t.schedule_cron}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ContentColumn>
      </PageBody>
    </PageShell>
  );
}
