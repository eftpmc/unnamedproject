import { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { getChats, deleteChat, searchChats, getProjects, updateChatConfig } from '../lib/api.js';
import { cn, timeAgo } from '../lib/utils.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { DataTable, DataTableBody, DataTableHeader, DataTableRow } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ContentColumn, EmptyPanel, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { Project, Session } from '../types.js';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const projectFilter = searchParams.get('project');
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

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => getProjects(),
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

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => updateChatConfig(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chats-search'] });
      setRenaming(null);
    },
  });

  function commitRename() {
    if (!renaming) return;
    const trimmed = renaming.value.trim();
    if (!trimmed) { setRenaming(null); return; }
    const original = chats.find(c => c.id === renaming.id)?.title;
    if (trimmed === original) { setRenaming(null); return; }
    renameMutation.mutate({ id: renaming.id, title: trimmed });
  }

  const isSearchActive = debouncedQuery.length >= 2;
  const baseChats = isSearchActive ? (searchResults ?? []) : chats;
  const displayedChats = projectFilter
    ? baseChats.filter(c => c.pinned_project_id === projectFilter)
    : baseChats;

  // Only show projects that actually have chats pinned to them
  const projectsWithChats = projects.filter(p => chats.some(c => c.pinned_project_id === p.id));

  function updateProjectFilter(projectId: string | null) {
    const next = new URLSearchParams(searchParams);
    if (projectId) next.set('project', projectId);
    else next.delete('project');
    setSearchParams(next, { replace: true });
  }

  return (
    <PageShell>
      <PageHeader
        title="Chats"
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
        actions={
          <Button size="lg" className="h-9 gap-2 rounded-lg px-3 text-sm shadow-sm" onClick={() => navigate('/c')}>
            <Plus size={16} />New chat
          </Button>
        }
      />

      {isLoading ? (
        <PageLoading rows={5} />
      ) : (
        <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
          <ContentColumn className="max-w-7xl">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative min-w-0 flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint-fg pointer-events-none" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search chats…"
                  className="h-9 w-full rounded-lg border border-border-soft bg-card py-2 pl-8 pr-8 text-sm text-foreground placeholder:text-faint-fg transition-colors focus:border-border focus:outline-none focus:ring-2 focus:ring-ring"
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
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => updateProjectFilter(null)}
                  className={cn(
                    'h-8 rounded-lg px-2.5 text-sm transition-colors',
                    !projectFilter ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  All
                </button>
                {projectsWithChats.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'flex h-8 items-center gap-1 rounded-lg px-2.5 text-sm transition-colors',
                          projectFilter ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                        )}
                      >
                        {projectFilter ? (projectById[projectFilter]?.name ?? 'Project') : 'Project'}
                        <ChevronDown size={12} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      {projectsWithChats.map(project => (
                        <DropdownMenuItem
                          key={project.id}
                          onSelect={() => updateProjectFilter(project.id === projectFilter ? null : project.id)}
                          className={cn(projectFilter === project.id && 'font-medium')}
                        >
                          {project.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

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
                <div>
                  {groups.map(({ label, chats: groupChats }) => (
                    <section key={label} className="mb-6 last:mb-0">
                      {label && (
                        <div className="mb-2 text-xs font-medium text-muted-foreground">
                          {label}
                        </div>
                      )}
                      <DataTable>
                        <DataTableHeader className="grid-cols-[minmax(0,1fr)_1.75rem] sm:grid-cols-[minmax(0,1fr)_6rem_1.75rem] lg:grid-cols-[minmax(0,1fr)_12rem_6rem_1.75rem]">
                          <span>Title</span>
                          <span className="hidden lg:block">Project</span>
                          <span className="hidden justify-self-end sm:block">Updated</span>
                          <span />
                        </DataTableHeader>
                        <DataTableBody>
                          {groupChats.map(chat => {
                            const project = chat.pinned_project_id ? projectById[chat.pinned_project_id] : null;
                            return (
                              <DataTableRow
                                key={chat.id}
                                className="grid-cols-[minmax(0,1fr)_1.75rem] sm:grid-cols-[minmax(0,1fr)_6rem_1.75rem] lg:grid-cols-[minmax(0,1fr)_12rem_6rem_1.75rem]"
                              >
                                <div className="min-w-0">
                                  {renaming?.id === chat.id ? (
                                    <input
                                      ref={renameInputRef}
                                      className="w-full rounded border border-ring bg-background px-1 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring/50"
                                      value={renaming.value}
                                      onChange={e => setRenaming(r => r ? { ...r, value: e.target.value } : r)}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                                        if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); }
                                      }}
                                      onBlur={commitRename}
                                    />
                                  ) : (
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      aria-label={`Open chat: ${chat.title ?? 'Untitled chat'}`}
                                      className="cursor-pointer text-left"
                                      onClick={() => navigate(`/c/${chat.id}`)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          navigate(`/c/${chat.id}`);
                                        }
                                      }}
                                    >
                                      <div className="truncate text-sm font-medium text-foreground underline-offset-2 hover:underline">
                                        {chat.title ?? 'Untitled chat'}
                                      </div>
                                      <div className="mt-0.5 flex gap-2 text-[11px] text-faint-fg sm:hidden">
                                        <span className="truncate">{project?.name ?? 'No project'}</span>
                                        <span className="shrink-0">·</span>
                                        <span className="shrink-0">{timeAgo(chat.updated_at)}</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div className="hidden min-w-0 lg:block">
                                  {project ? (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); updateProjectFilter(project.id === projectFilter ? null : project.id); }}
                                      className={cn('block max-w-full truncate text-left text-xs text-muted-foreground transition-colors hover:text-foreground', projectFilter === project.id && 'text-foreground font-medium')}
                                    >
                                      {project.name}
                                    </button>
                                  ) : (
                                    <span className="text-xs text-faint-fg">None</span>
                                  )}
                                </div>
                                <span className="hidden justify-self-end whitespace-nowrap text-[11px] text-faint-fg sm:block">{timeAgo(chat.updated_at)}</span>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label={`Options for ${chat.title ?? 'Untitled chat'}`}
                                      className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                                    >
                                      <MoreHorizontal size={14} />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-40">
                                    <DropdownMenuItem
                                      onSelect={() => { setRenaming({ id: chat.id, value: chat.title ?? '' }); setTimeout(() => renameInputRef.current?.select(), 0); }}
                                    >
                                      <Pencil size={14} />
                                      Rename
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onSelect={() => setPendingDelete(chat.id)}
                                    >
                                      <Trash2 size={14} />
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </DataTableRow>
                            );
                          })}
                        </DataTableBody>
                      </DataTable>
                    </section>
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
