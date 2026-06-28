import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Search } from 'lucide-react';
import { getAllDocuments } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { timeAgo } from '../lib/utils.js';
import { Input } from '@/components/ui/input';
import { CenteredEmptyState, ContentColumn, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { Document } from '../types.js';

export default function DocumentsPage() {
  usePageTitle('Documents');
  const [search, setSearch] = useState('');

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ['documents-global'],
    queryFn: () => getAllDocuments(),
  });

  const visible = search.trim()
    ? documents.filter(d => d.title.toLowerCase().includes(search.toLowerCase()))
    : documents;

  return (
    <PageShell>
      <PageHeader title="Documents" className="border-0 pb-0" contentClassName="max-w-5xl" />

      {isLoading ? <PageLoading rows={4} /> : documents.length === 0 ? (
        <CenteredEmptyState
          title="No documents yet"
          description="Documents created by the agent will appear here."
        />
      ) : (
        <PageBody>
          <ContentColumn className="max-w-5xl">
            <div className="relative mb-5">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint-fg pointer-events-none" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search documents…"
                className="pl-8"
              />
            </div>
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">No results for "{search}".</p>
            ) : (
              <div className="flex flex-col gap-2">
                {visible.map(doc => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">
                      <FileText size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{doc.title}</span>
                      <span className="block text-[11px] text-faint-fg">
                        {[doc.type, timeAgo(doc.updated_at)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {doc.status && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                        {doc.status}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ContentColumn>
        </PageBody>
      )}
    </PageShell>
  );
}
