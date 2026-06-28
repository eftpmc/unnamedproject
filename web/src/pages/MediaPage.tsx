import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, MoreHorizontal, Search } from 'lucide-react';
import { getMedia } from '../lib/api.js';
import { getToken } from '../lib/auth.js';
import { timeAgo } from '../lib/utils.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { Input } from '@/components/ui/input';
import { CenteredEmptyState, ContentColumn, EmptyPanel, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import { DataTable, DataTableBody, DataTableHeader, DataTableRow } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FilterStrip } from '@/components/ui/filter-strip';
import type { MediaItem } from '../types.js';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function mediaKind(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'Image';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.includes('json')) return 'JSON';
  if (mimeType.includes('markdown')) return 'Markdown';
  if (mimeType.startsWith('text/')) return 'Text';
  return mimeType.split('/')[1]?.toUpperCase() || 'File';
}

async function downloadMedia(item: MediaItem) {
  const token = getToken();
  const res = await fetch(item.url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = item.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export default function MediaPage() {
  usePageTitle('Media');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data: media = [], isLoading } = useQuery<MediaItem[]>({
    queryKey: ['media'],
    queryFn: getMedia,
  });

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return media.filter(item => {
      const matchesFilter =
        filter === 'all'
        || (filter === 'image' && item.mimeType.startsWith('image/'))
        || (filter === 'pdf' && item.mimeType === 'application/pdf')
        || (filter === 'text' && (item.mimeType.startsWith('text/') || item.mimeType.includes('markdown')))
        || (filter === 'code' && /\.(c|cc|cpp|css|go|h|hpp|java|js|jsx|json|kt|py|rb|rs|sh|sql|swift|toml|ts|tsx|xml|ya?ml|zsh)$/i.test(item.filename));
      if (!matchesFilter) return false;
      if (!query) return true;
      return item.filename.toLowerCase().includes(query)
        || item.mimeType.toLowerCase().includes(query)
        || (item.sessionTitle ?? '').toLowerCase().includes(query);
    });
  }, [filter, media, search]);

  async function handleDownload(item: MediaItem) {
    setDownloadingId(item.id);
    try {
      await downloadMedia(item);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Media"
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
      />

      {isLoading ? <PageLoading rows={4} /> : media.length === 0 ? (
        <CenteredEmptyState
          title="No media yet"
          description="Files attached to chats will appear here."
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
                  placeholder="Search media…"
                  className="pl-8"
                />
              </div>
              <FilterStrip
                value={filter}
                onValueChange={setFilter}
                items={[
                  { value: 'all', label: 'All' },
                  { value: 'image', label: 'Images' },
                  { value: 'pdf', label: 'PDFs' },
                  { value: 'text', label: 'Text' },
                  { value: 'code', label: 'Code' },
                ]}
              />
            </div>

            {visible.length === 0 ? (
              <EmptyPanel title="No results" description={`Nothing matched "${search}".`} />
            ) : (
              <DataTable>
                <DataTableHeader className="grid-cols-[minmax(0,1fr)_1.75rem] sm:grid-cols-[minmax(0,1fr)_7rem_7rem_1.75rem] lg:grid-cols-[minmax(0,1fr)_8rem_12rem_7rem_1.75rem]">
                  <span>Name</span>
                  <span className="hidden sm:block">Type</span>
                  <span className="hidden lg:block">Chat</span>
                  <span className="hidden justify-self-end sm:block">Added</span>
                  <span />
                </DataTableHeader>
                <DataTableBody>
                  {visible.map(item => (
                    <DataTableRow
                      key={item.id}
                      className="grid-cols-[minmax(0,1fr)_1.75rem] sm:grid-cols-[minmax(0,1fr)_7rem_7rem_1.75rem] lg:grid-cols-[minmax(0,1fr)_8rem_12rem_7rem_1.75rem]"
                    >
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => handleDownload(item)}
                          className="block max-w-full truncate text-left text-sm font-medium text-foreground underline-offset-2 hover:underline"
                        >
                          {item.filename}
                        </button>
                        <div className="mt-0.5 flex min-w-0 gap-2 text-[11px] text-faint-fg sm:hidden">
                          <span className="shrink-0">{mediaKind(item.mimeType)}</span>
                          <span className="shrink-0">·</span>
                          <span className="shrink-0">{formatBytes(item.sizeBytes)}</span>
                          <span className="shrink-0">·</span>
                          <span className="truncate">{item.sessionTitle ?? 'Untitled chat'}</span>
                        </div>
                      </div>
                      <span className="hidden truncate text-xs text-muted-foreground sm:block">
                        {mediaKind(item.mimeType)} · {formatBytes(item.sizeBytes)}
                      </span>
                      <Link
                        to={`/c/${item.sessionId}`}
                        className="hidden truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline lg:block"
                      >
                        {item.sessionTitle ?? 'Untitled chat'}
                      </Link>
                      <span className="hidden justify-self-end whitespace-nowrap text-[11px] text-faint-fg sm:block">
                        {timeAgo(item.createdAt)}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Options for ${item.filename}`}
                            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem
                            disabled={downloadingId === item.id}
                            onSelect={() => handleDownload(item)}
                          >
                            <Download size={14} />
                            Download
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
