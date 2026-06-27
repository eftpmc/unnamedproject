import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Search, Trash2, X } from 'lucide-react';
import { getChats, deleteChat, searchChats, getSpaces } from '../lib/api.js';
import { cn, timeAgo } from '../lib/utils.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { ContentColumn, EmptyPanel, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { Space, Session } from '../types.js';
import { useDebounce } from '../lib/useDebounce.js';

function dateGroup(unixSeconds: number): string {
  const now = new Date();
  const d = new Date(unixSeconds * 1000);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400_000;
  const startOfWeek = startOfToday - (now.getDay() === 0 ? 6 : now.getDay() - 1) * 86400_000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return 'Today';
  if (t >= startOfYesterday) return 'Yesterday';
  if (t >= startOfWeek) return 'This week';
  if (t >= startOfMonth) return 'This month';
  return d.toLocaleString('default', { month: 'long', year: now.getFullYear() !== d.getFullYear() ? 'numeric' : undefined });
}

function groupChats(chats: Session[]): { label: string; chats: Session[] }[] {
  const groups: Map<string, Session[]> = new Map();
  for (const chat of chats) {
    const label = dateGroup(chat.updated_at);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(chat);
  }
  return Array.from(groups.entries()).map(([label, chats]) => ({ label, chats }));
}

const PAGE_SIZE = 100;

export default function ChatsPage() {
  usePageTitle('Chats');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const debouncedQuery = useDebounce(searchQuery, 300);
  const [extraChats, setExtraChats] = useState<Session[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data: firstPage = [], isLoading } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: () => getChats(),
  });

  const chats = [...firstPage, ...extraChats];
  const hasMore = firstPage.length === PAGE_SIZE && extraChats.length === 0
    || (extraChats.length > 0 && extraChats.length % PAGE_SIZE === 0);

  async function loadMore() {
    const last = chats[chats.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const more = await getChats({ before: last.updated_at });
      setExtraChats(prev => [...prev, ...more]);
    } finally {
      setLoadingMore(false);
    }
  }

  const { data: projects = [] } = useQuery<Space[]>({
    queryKey: ['spaces'],
    queryFn: getSpaces,
    staleTime: 60_000,
  });
  const projectById = Object.fromEntries(projects.map(p => [p.id, p]));

  const { data: searchResults, isFetching: isSearching } = useQuery<Session[]>({
    queryKey: ['chats-search', debouncedQuery],
    queryFn: () => searchChats(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
    staleTime: 10_000,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteChat,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chats-search'] });
      setPendingDelete(null);
    },
    onError: () => setPendingDelete(null),
  });

  const isSearchActive = debouncedQuery.length >= 2;
  const baseChats = isSearchActive ? (searchResults ?? []) : chats;
  const displayedChats = projectFilter
    ? baseChats.filter(c => c.pinned_space_id === projectFilter)
    : baseChats;

  return (
    <PageShell>
      <PageHeader title="Chats" className="border-0 pb-0" contentClassName="max-w-4xl" />

      {isLoading ? (
        <PageLoading rows={5} />
      ) : (
        <PageBody>
          <ContentColumn className="max-w-4xl">
            <div className="relative mb-5">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint-fg pointer-events-none" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search chats…"
                className="w-full rounded-lg border border-border-soft bg-card py-2 pl-8 pr-8 text-sm text-foreground placeholder:text-faint-fg focus:border-border focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint-fg hover:text-muted-foreground transition-colors"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {projectFilter && (
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Filtered by</span>
                <button
                  type="button"
                  onClick={() => setProjectFilter(null)}
                  className="flex items-center gap-1 rounded-md border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                >
                  {projectById[projectFilter]?.name ?? 'Space'}
                  <X size={11} className="ml-0.5 text-faint-fg" />
                </button>
              </div>
            )}

            {isSearchActive && (
              <p className="mb-3 text-xs text-muted-foreground">
                {isSearching ? 'Searching…' : `${displayedChats.length} result${displayedChats.length !== 1 ? 's' : ''}`}
              </p>
            )}

            {displayedChats.length === 0 ? (
              <EmptyPanel
                title={isSearchActive || projectFilter ? 'No results' : 'No chats yet'}
                description={isSearchActive
                  ? `Nothing matched "${debouncedQuery}".`
                  : projectFilter
                    ? 'No chats pinned to this project.'
                    : 'Start a conversation to plan work, inspect a project, or make a change.'}
              />
            ) : (() => {
              const useGroups = !isSearchActive && !projectFilter;
              const groups = useGroups ? groupChats(displayedChats) : [{ label: '', chats: displayedChats }];
              return (
                <div className="flex flex-col gap-5">
                  {groups.map(({ label, chats: groupChats }) => (
                    <div key={label}>
                      {label && (
                        <div className="mb-2 px-1 text-[11px] font-semibold text-faint-fg">
                          {label}
                        </div>
                      )}
                      <div className="flex flex-col gap-2">
                        {groupChats.map(chat => {
                          const project = chat.pinned_space_id ? projectById[chat.pinned_space_id] : null;
                          return (
                            <div
                              key={chat.id}
                              className="group flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3 transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm"
                            >
                              <div
                                role="button"
                                tabIndex={0}
                                aria-label={`Open chat: ${chat.title ?? 'Untitled chat'}`}
                                className="min-w-0 flex-1 text-left cursor-pointer"
                                onClick={() => navigate(`/c/${chat.id}`)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    navigate(`/c/${chat.id}`);
                                  }
                                }}
                              >
                                <div className="truncate text-sm font-medium text-foreground">
                                  {chat.title ?? 'Untitled chat'}
                                </div>
                                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint-fg">
                                  <span>{timeAgo(chat.updated_at)}</span>
                                  {project && (
                                    <>
                                      <span>·</span>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setProjectFilter(project.id === projectFilter ? null : project.id); }}
                                        className={cn('truncate transition-colors hover:text-foreground', projectFilter === project.id && 'text-foreground font-medium')}
                                      >
                                        {project.name}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                              <ChevronRight
                                size={14}
                                className="shrink-0 text-faint-fg transition-colors group-hover:text-muted-foreground"
                                onClick={() => navigate(`/c/${chat.id}`)}
                              />
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Delete chat: ${chat.title ?? 'Untitled chat'}`}
                                className="shrink-0 text-faint-fg opacity-0 transition-[opacity,color] hover:text-destructive group-hover:opacity-100"
                                onClick={() => setPendingDelete(chat.id)}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {!isSearchActive && hasMore && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </ContentColumn>
        </PageBody>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete chat?"
          description="This will permanently delete the chat and all its messages."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </PageShell>
  );
}
