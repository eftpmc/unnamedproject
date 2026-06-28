import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clipboard, MoreHorizontal, Search } from 'lucide-react';
import { getAllDocuments } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { timeAgo } from '../lib/utils.js';
import { Input } from '@/components/ui/input';
import { CenteredEmptyState, ContentColumn, EmptyPanel, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import { DataTable, DataTableBody, DataTableHeader, DataTableRow } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FilterStrip } from '@/components/ui/filter-strip';
import type { Document } from '../types.js';

function documentKind(doc: Document): string {
  if (doc.type) return doc.type;
  if (doc.path.endsWith('.md') || doc.path.endsWith('.mdx')) return 'Markdown';
  return 'Document';
}

export default function DocumentsPage() {
  usePageTitle('Documents');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ['documents-global'],
    queryFn: () => getAllDocuments(),
  });

  const filters = [
    { value: 'all', label: 'All' },
    ...Array.from(new Set(documents.map(documentKind)))
      .sort((a, b) => a.localeCompare(b))
      .map(kind => ({ value: kind, label: kind })),
  ];
  const visible = documents.filter(doc => {
    const query = search.trim().toLowerCase();
    const kind = documentKind(doc);
    if (filter !== 'all' && kind !== filter) return false;
    if (!query) return true;
    return doc.title.toLowerCase().includes(query)
      || doc.path.toLowerCase().includes(query)
      || kind.toLowerCase().includes(query);
  });

  function copyPath(path: string) {
    void navigator.clipboard?.writeText(path);
  }

  return (
    <PageShell>
      <PageHeader
        title="Documents"
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
      />

      {isLoading ? <PageLoading rows={4} /> : documents.length === 0 ? (
        <CenteredEmptyState
          title="No documents yet"
          description="Documents created by the agent will appear here."
        />
      ) : (
        <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
          <ContentColumn className="max-w-7xl">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative min-w-0 flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint-fg pointer-events-none" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search documents…"
                  className="pl-8"
                />
              </div>
              <FilterStrip value={filter} items={filters} onValueChange={setFilter} />
            </div>
            {visible.length === 0 ? (
              <EmptyPanel title="No results" description={`Nothing matched "${search || filter}".`} />
            ) : (
              <DataTable>
                <DataTableHeader className="grid-cols-[minmax(0,1fr)_1.75rem] sm:grid-cols-[minmax(0,1fr)_8rem_6rem_1.75rem]">
                  <span>Title</span>
                  <span className="hidden sm:block">Type</span>
                  <span className="hidden justify-self-end sm:block">Updated</span>
                  <span />
                </DataTableHeader>
                <DataTableBody>
                  {visible.map(doc => (
                    <DataTableRow
                      key={doc.id}
                      className="grid-cols-[minmax(0,1fr)_1.75rem] sm:grid-cols-[minmax(0,1fr)_8rem_6rem_1.75rem]"
                    >
                      <div className="min-w-0">
                        <Link to={`/documents/${doc.id}`} className="block truncate text-sm font-medium text-foreground underline-offset-2 hover:underline">
                          {doc.title}
                        </Link>
                        <div className="mt-0.5 flex gap-2 text-[11px] text-faint-fg sm:hidden">
                          <span className="truncate">{documentKind(doc)}</span>
                          <span className="shrink-0">·</span>
                          <span className="shrink-0">{timeAgo(doc.updated_at)}</span>
                        </div>
                      </div>
                      <span className="hidden truncate text-xs text-muted-foreground sm:block">{documentKind(doc)}</span>
                      <span className="hidden justify-self-end whitespace-nowrap text-[11px] text-faint-fg sm:block">{timeAgo(doc.updated_at)}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Options for ${doc.title}`}
                            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem onSelect={() => copyPath(doc.path)}>
                            <Clipboard size={14} />
                            Copy path
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            )}
          </ContentColumn>
        </PageBody>
      )}
    </PageShell>
  );
}
