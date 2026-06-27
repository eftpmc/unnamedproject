import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { subscribe } from '../lib/ws.js';
import { getToken } from '../lib/auth.js';
import {
  AlignLeft,
  ArrowLeft,
  Check,
  ChevronRight,
  Code2,
  Download,
  File,
  FileText,
  FileType,
  FolderGit2,
  GitBranch,
  GripVertical,
  LayoutDashboard,
  Link2,
  ListChecks,
  ListOrdered,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import {
  createChat,
  createSpaceItem,
  deleteSpace,
  deleteSpaceItem,
  deleteItemFile,
  getChats,
  getConnections,
  getItemContent,
  getItemFiles,
  getItemSessions,
  getSpaceItems,
  getSpaces,
  listItemTemplates,
  updateChatConfig,
  updateSpace,
  updateSpaceItem,
  uploadItemFile,
  type ItemFile,
} from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { timeAgo, cn } from '../lib/utils.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ContentColumn, EmptyPanel, PageBody, PageHeader, PageLoading, PageShell, Surface } from '@/components/ui/app-layout';
import { TabStrip } from '@/components/ui/tab-strip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import FileBrowser from '../components/FileBrowser.js';
import BlockRenderer from '../components/BlockRenderer.js';
import EditableTitle from '../components/EditableTitle.js';
import type { Block, Connection, RepoItem, FileItem, Session, Space, SpaceItem, WSEvent, WSSessionEventCreated } from '../types.js';

type Section = 'overview' | 'chats' | 'items' | 'settings';

function sectionFromPath(pathname: string, spaceId: string): Section {
  const suffix = pathname.slice(`/spaces/${spaceId}`.length).split('/').filter(Boolean)[0];
  return ['chats', 'items', 'settings'].includes(suffix) ? suffix as Section : 'overview';
}

export default function SpacePage() {
  const { spaceId, itemId } = useParams<{ spaceId: string; itemId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const section = sectionFromPath(location.pathname, spaceId!);

  const { data: spaces = [], isLoading } = useQuery<Space[]>({ queryKey: ['spaces'], queryFn: getSpaces });
  const space = spaces.find(candidate => candidate.id === spaceId) ?? null;
  const { data: items = [] } = useQuery({
    queryKey: ['space-items', spaceId],
    queryFn: () => getSpaceItems(spaceId!),
    enabled: !!spaceId,
  });
  const { data: chats = [] } = useQuery<Session[]>({ queryKey: ['chats'], queryFn: () => getChats() });
  const spaceChats = chats.filter(chat => chat.pinned_space_id === spaceId);
  const currentItem = itemId ? items.find(item => item.id === itemId) ?? null : null;

  usePageTitle(currentItem?.name ?? space?.name);

  const startChat = useMutation({
    mutationFn: async () => {
      const created = await createChat();
      await updateChatConfig(created.id, { pinned_space_id: spaceId! });
      return created.id;
    },
    onSuccess: id => navigate(`/c/${id}`),
  });

  // Invalidate space items in real-time when the agent creates or updates items
  useEffect(() => {
    return subscribe((event: WSEvent) => {
      if (event.type === 'session_event_created') {
        const ev = event as WSSessionEventCreated;
        if (
          (ev.event.type === 'item_created' || ev.event.type === 'item_updated') &&
          ev.event.space_id === spaceId
        ) {
          queryClient.invalidateQueries({ queryKey: ['space-items', spaceId] });
        }
      }
    });
  }, [spaceId, queryClient]);

  if (isLoading) return <PageShell><PageLoading rows={4} /></PageShell>;
  if (!space) {
    return <PageShell><PageHeader title="Space not found" /></PageShell>;
  }

  if (itemId) {
    return currentItem
      ? <ItemDetail space={space} item={currentItem} />
      : <PageShell><PageHeader title="Item not found" /></PageShell>;
  }

  return (
    <PageShell>
      <PageHeader
        className="border-0 pb-0"
        contentClassName="max-w-4xl"
        title={space.name}
        actions={section !== 'settings' ? (
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => startChat.mutate()} disabled={startChat.isPending}>
            <MessageSquare size={14} />
            New chat
          </Button>
        ) : undefined}
      />
      <SpaceTabs spaceId={space.id} section={section} />
      {section === 'overview' && <Overview space={space} items={items} chats={spaceChats} onNewChat={() => startChat.mutate()} />}
      {section === 'chats' && <ChatsSection chats={spaceChats} onNewChat={() => startChat.mutate()} />}
      {section === 'items' && <ItemsSection space={space} items={items} />}
      {section === 'settings' && <SettingsSection space={space} />}
    </PageShell>
  );
}

function OverviewCard({ type, title, subtitle, href }: { type: string; title: string; subtitle: string; href: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(href)}
      className="flex w-full items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      <ItemIcon type={type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        <span className="block text-[11px] text-faint-fg">{subtitle}</span>
      </span>
      <ChevronRight size={14} className="shrink-0 text-faint-fg" />
    </button>
  );
}

function OverviewSection({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function Overview({ space, items, chats, onNewChat }: { space: Space; items: SpaceItem[]; chats: Session[]; onNewChat: () => void }) {
  const navigate = useNavigate();
  const recentItems = [...items].sort((a, b) => b.created_at - a.created_at).slice(0, 8);
  const recentChats = [...chats].sort((a, b) => b.updated_at - a.updated_at).slice(0, 5);
  const isEmpty = items.length === 0 && chats.length === 0;

  return (
    <PageBody>
      <ContentColumn className="flex max-w-4xl flex-col gap-8 py-6">
        {space.description && (
          <p className="text-sm leading-relaxed text-muted-foreground">{space.description}</p>
        )}
        {isEmpty ? (
          <EmptyPanel
            title="Nothing here yet"
            description="Start a chat pinned to this space, or add an item to track your work."
            action={(
              <div className="flex gap-2">
                <Button size="sm" className="gap-1.5" onClick={onNewChat}>
                  <MessageSquare size={13} />Start chat
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(`/spaces/${space.id}/items`)}>
                  <Plus size={13} />Add item
                </Button>
              </div>
            )}
          />
        ) : (
          <>
            {recentItems.length > 0 && (
              <OverviewSection
                label="Items"
                action={
                  <button type="button" onClick={() => navigate(`/spaces/${space.id}/items`)} className="text-[11px] text-faint-fg hover:text-muted-foreground">
                    View all →
                  </button>
                }
              >
                {recentItems.map(item => {
                  const preview = itemPreview(item);
                  const blockCount = item.page_blocks.length;
                  const meta = [
                    preview ? preview.slice(0, 60) : null,
                    blockCount > 0 ? `${blockCount} block${blockCount === 1 ? '' : 's'}` : null,
                    timeAgo(item.created_at),
                  ].filter(Boolean).join(' · ');
                  return (
                    <OverviewCard
                      key={item.id}
                      type={item.type}
                      title={item.name}
                      subtitle={meta}
                      href={`/spaces/${space.id}/items/${item.id}`}
                    />
                  );
                })}
              </OverviewSection>
            )}
            {recentChats.length > 0 && (
              <OverviewSection
                label="Chats"
                action={
                  <button type="button" onClick={() => navigate(`/spaces/${space.id}/chats`)} className="text-[11px] text-faint-fg hover:text-muted-foreground">
                    View all →
                  </button>
                }
              >
                {recentChats.map(chat => (
                  <OverviewCard
                    key={chat.id}
                    type="Chat"
                    title={chat.title ?? 'Untitled chat'}
                    subtitle={timeAgo(chat.updated_at)}
                    href={`/c/${chat.id}`}
                  />
                ))}
              </OverviewSection>
            )}
          </>
        )}
      </ContentColumn>
    </PageBody>
  );
}

function ChatsSection({ chats, onNewChat }: { chats: Session[]; onNewChat: () => void }) {
  const navigate = useNavigate();
  return (
    <PageBody>
      <ContentColumn className="max-w-4xl">
        {chats.length === 0 ? (
          <EmptyPanel title="No chats yet" description="Chats started from this Space stay connected to its context." action={<Button size="sm" onClick={onNewChat}>Start chat</Button>} />
        ) : (
          <div className="flex flex-col gap-2">
            {chats.map(chat => (
              <button
                key={chat.id}
                type="button"
                onClick={() => navigate(`/c/${chat.id}`)}
                className="flex w-full items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3.5 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <MessageSquare size={15} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{chat.title ?? 'Untitled chat'}</span>
                <span className="shrink-0 text-xs text-faint-fg">{timeAgo(chat.updated_at)}</span>
                <ChevronRight size={15} className="shrink-0 text-faint-fg" />
              </button>
            ))}
          </div>
        )}
      </ContentColumn>
    </PageBody>
  );
}

function itemPreview(item: SpaceItem): string | null {
  if (item.type === 'repo') return (item.fields.repo_path as string | undefined) ?? null;
  if (item.type === 'file') return (item.fields.file_path as string | undefined) ?? null;
  for (const block of item.page_blocks) {
    if (block.type === 'text' && block.content.trim()) return block.content.trim();
    if (block.type === 'heading' && block.text.trim()) return block.text.trim();
  }
  return null;
}

const ITEMS_PAGE_SIZE = 100;

function ItemsSection({ space, items: firstPage }: { space: Space; items: SpaceItem[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [type, setType] = useState<string>('blank');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [pendingDelete, setPendingDelete] = useState<SpaceItem | null>(null);
  const [extraItems, setExtraItems] = useState<SpaceItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const items = [...firstPage, ...extraItems];
  const hasMore = (firstPage.length === ITEMS_PAGE_SIZE && extraItems.length === 0)
    || (extraItems.length > 0 && extraItems.length % ITEMS_PAGE_SIZE === 0);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const more = await getSpaceItems(space.id, { before: last.created_at });
      setExtraItems(prev => [...prev, ...more]);
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = filter === 'all' ? items : items.filter(item => item.type === filter);
  const visible = search.trim() ? filtered.filter(item => item.name.toLowerCase().includes(search.trim().toLowerCase())) : filtered;
  const requiresValue = type === 'repo' || type === 'file';

  const { data: templates = [] } = useQuery({
    queryKey: ['item-templates'],
    queryFn: listItemTemplates,
  });
  const blockTemplates = templates.filter(t => t.kind === 'blocks');
  const dialogTypes = [
    ...blockTemplates.map(t => ({ id: t.id, label: t.name })),
    { id: 'repo', label: 'Repo' },
    { id: 'file', label: 'File' },
  ];

  const createMutation = useMutation({
    mutationFn: () => createSpaceItem(space.id, {
      type,
      name: name.trim(),
      ...(type === 'repo' ? { repo_path: value.trim() } : {}),
      ...(type === 'file' ? { file_path: value.trim() } : {}),
    }),
    onSuccess: item => {
      queryClient.invalidateQueries({ queryKey: ['space-items', space.id] });
      setDialogOpen(false);
      setName('');
      setValue('');
      navigate(`/spaces/${space.id}/items/${item.id}`);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => deleteSpaceItem(space.id, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-items', space.id] });
      setPendingDelete(null);
    },
  });

  return (
    <PageBody>
      <ContentColumn className="max-w-4xl">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger size="sm" className="h-8 w-32 text-xs capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {[...new Set(items.map(i => i.type))].map(t => {
                const label = templates.find(tpl => tpl.id === t)?.name ?? t;
                return <SelectItem key={t} value={t}>{label}</SelectItem>;
              })}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint-fg pointer-events-none" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search items…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setDialogOpen(true)}>
            <Plus size={14} />Add Item
          </Button>
        </div>

        {visible.length === 0 ? (
          <EmptyPanel title={items.length === 0 ? 'No items yet' : search.trim() ? 'No results' : `No ${templates.find(t => t.id === filter)?.name ?? filter} items`} description="Add a repository, file, or templated item to this Space." />
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map(item => {
              const preview = itemPreview(item);
              const blockCount = item.page_blocks.length;
              const typeName = templates.find(t => t.id === item.type)?.name ?? item.type;
              const meta = [
                typeName,
                blockCount > 0 ? `${blockCount} block${blockCount === 1 ? '' : 's'}` : null,
                timeAgo(item.created_at),
              ].filter(Boolean).join(' · ');
              return (
              <div key={item.id} className="group flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3 transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm">
                <button type="button" onClick={() => navigate(`/spaces/${space.id}/items/${item.id}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none">
                  <ItemIcon type={item.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-faint-fg">
                      {preview ? `${preview.slice(0, 60)} · ` : ''}{meta}
                    </span>
                  </span>
                  <ChevronRight size={14} className="shrink-0 text-faint-fg" />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100"><MoreHorizontal size={14} /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(item)}>
                      <Trash2 size={14} />Delete Item
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              );
            })}
          </div>
        )}

        {!search.trim() && hasMore && (
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Item</DialogTitle>
            <DialogDescription>Items are the durable contents of this Space.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {dialogTypes.map(candidate => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => { setType(candidate.id); setValue(''); }}
                className={cn('rounded-md px-2 py-1.5 text-xs font-medium capitalize', type === candidate.id ? 'bg-card shadow-xs' : 'text-muted-foreground')}
              >
                {candidate.label}
              </button>
            ))}
          </div>
          <Input placeholder="Item name" value={name} onChange={event => setName(event.target.value)} />
          {requiresValue && (
            <Input
              value={value}
              onChange={event => setValue(event.target.value)}
              placeholder={type === 'repo' ? '/Users/you/code/repository' : '/absolute/path/to/file.pdf'}
            />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button disabled={!name.trim() || (requiresValue && !value.trim()) || createMutation.isPending} onClick={() => createMutation.mutate()}>
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.name}?`}
          description="This removes the Item from the Space. Repository contents on disk are not deleted."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </PageBody>
  );
}

function SettingsSection({ space }: { space: Space }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: connections = [] } = useQuery<Connection[]>({ queryKey: ['connections'], queryFn: getConnections });
  const mcpConnections = connections.filter(c => c.type === 'mcp');

  const updateMutation = useMutation({
    mutationFn: () => updateSpace(space.id, { name: name.trim() || space.name, description: description.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spaces'] }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteSpace(space.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      navigate('/spaces');
    },
  });

  function toggleConnection(id: string) {
    const current = space.enabled_connection_ids ?? [];
    const updated = current.includes(id) ? current.filter(c => c !== id) : [...current, id];
    updateSpace(space.id, { enabled_connection_ids: updated }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['spaces'] }),
    );
  }

  return (
    <PageBody>
      <ContentColumn className="max-w-4xl">
        <div className="flex flex-col gap-8">
          <section className="space-y-4">
            <div><h2 className="text-sm font-semibold">General</h2><p className="mt-1 text-xs text-muted-foreground">Basic information shown across chats and navigation.</p></div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Space name</label>
              <Input value={name} onChange={event => setName(event.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Description</label>
              <textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex justify-end">
              <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate()}>
                <Check size={13} />{updateMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <div><h2 className="text-sm font-semibold">MCP tools</h2><p className="mt-1 text-xs text-muted-foreground">Tools enabled here are available to the agent when working in this Space.</p></div>
            {mcpConnections.length === 0 ? (
              <p className="text-xs text-muted-foreground">No MCP servers connected. Add them in <Link to="/settings" className="underline underline-offset-2 hover:text-foreground">Settings → MCP</Link>.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {mcpConnections.map(conn => {
                  const enabled = (space.enabled_connection_ids ?? []).includes(conn.id);
                  return (
                    <div key={conn.id} className="flex items-center justify-between gap-3 rounded-lg border border-border-soft bg-card px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">{conn.name}</div>
                        <div className="text-xs text-faint-fg">MCP server</div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        onClick={() => toggleConnection(conn.id)}
                        className={cn(
                          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
                          enabled ? 'bg-primary' : 'bg-muted',
                        )}
                      >
                        <span className={cn('pointer-events-none inline-block size-4 rounded-full bg-white shadow-sm transition-transform', enabled ? 'translate-x-4' : 'translate-x-0')} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="flex items-center justify-between gap-4 rounded-lg border border-destructive/25 bg-destructive/5 p-4">
            <div><div className="text-sm font-medium">Delete Space</div><div className="mt-0.5 text-xs text-muted-foreground">Permanently removes its Items and links.</div></div>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
          </section>
        </div>
      </ContentColumn>
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${space.name}?`}
          description="This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </PageBody>
  );
}

function ItemSessionsChip({ spaceId, itemId }: { spaceId: string; itemId: string }) {
  const navigate = useNavigate();
  const { data: sessions = [] } = useQuery({
    queryKey: ['item-sessions', spaceId, itemId],
    queryFn: () => getItemSessions(spaceId, itemId),
    staleTime: 30_000,
  });

  if (sessions.length === 0) return null;

  return (
    <>
      <span className="text-muted-foreground/40">·</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-1.5 text-xs text-muted-foreground hover:text-foreground">
            <MessageSquare size={12} />
            {sessions.length === 1 ? '1 chat' : `${sessions.length} chats`}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1.5">
          <div className="flex flex-col gap-0.5">
            {sessions.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => navigate(`/c/${s.id}`)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted"
              >
                <MessageSquare size={12} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                  {s.title ?? 'Untitled chat'}
                </span>
                <span className="shrink-0 text-[11px] text-faint-fg">
                  {timeAgo(s.last_event_at)}
                </span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

function ItemDetail({ space, item }: { space: Space; item: SpaceItem }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const renameMutation = useMutation({
    mutationFn: (name: string) => updateSpaceItem(space.id, item.id, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['space-items', space.id] }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteSpaceItem(space.id, item.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-items', space.id] });
      navigate(`/spaces/${space.id}/items`);
    },
  });

  return (
    <PageShell>
      <PageHeader
        title={<EditableTitle title={item.name} onSave={(name) => renameMutation.mutate(name)} />}
        className="border-0 pb-0"
        contentClassName="max-w-4xl"
        breadcrumb={(
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => navigate(`/spaces/${space.id}/items`)}>
              <ArrowLeft size={13} />Items
            </Button>
            <ItemSessionsChip spaceId={space.id} itemId={item.id} />
          </div>
        )}
        actions={(
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm"><MoreHorizontal size={15} /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}><Trash2 size={14} />Delete Item</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        )}
      />
      {item.type === 'repo' && <RepoDetail space={space} item={item as RepoItem} />}
      {item.type === 'file' && <FileDetail space={space} item={item as FileItem} />}
      {item.type !== 'repo' && item.type !== 'file' && <TemplateItemDetail space={space} item={item} />}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${item.name}?`}
          description="This removes the Item from the Space."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </PageShell>
  );
}

function RepoDetail({ space, item }: { space: Space; item: RepoItem }) {
  return (
    <PageBody className="p-4 sm:p-5">
      {item.page_blocks.length > 0 && (
        <div className="mb-6 flex flex-col gap-4">
          {item.page_blocks.map((block, i) => (
            <BlockRenderer key={i} block={block} spaceId={space.id} itemId={item.id} />
          ))}
        </div>
      )}
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3">
        <GitBranch size={15} className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{item.fields.repo_path as string}</span>
        {item.fields.default_branch && <span className="rounded-md bg-muted px-2 py-1 font-mono text-[11px]">{item.fields.default_branch as string}</span>}
      </div>
      <FileBrowser spaceId={space.id} itemId={item.id} itemName={item.name} />
    </PageBody>
  );
}

function ItemFilesPanel({ spaceId, itemId }: { spaceId: string; itemId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const token = getToken();

  const { data: files = [] } = useQuery<ItemFile[]>({
    queryKey: ['item-files', spaceId, itemId],
    queryFn: () => getItemFiles(spaceId, itemId),
  });

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => deleteItemFile(spaceId, itemId, fileId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['item-files', spaceId, itemId] }),
  });

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadItemFile(spaceId, itemId, file);
      queryClient.invalidateQueries({ queryKey: ['item-files', spaceId, itemId] });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="mt-8 border-t border-border-soft pt-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">Attached files</span>
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-md border border-border-soft bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-50"
        >
          <Paperclip size={11} />
          {uploading ? 'Uploading…' : 'Upload file'}
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-faint-fg">No files attached.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {files.map(f => (
            <div key={f.id} className="group flex items-center gap-3 rounded-lg border border-border-soft bg-card px-3 py-2">
              <FileText size={14} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{f.filename}</span>
              <span className="text-xs text-faint-fg">{formatBytes(f.sizeBytes)}</span>
              <a href={token ? `${f.url}?token=${encodeURIComponent(token)}` : f.url} download={f.filename} className="text-faint-fg transition-colors hover:text-muted-foreground">
                <Download size={13} />
              </a>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(f.id)}
                className="text-faint-fg opacity-0 transition-[opacity,color] hover:text-destructive group-hover:opacity-100"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateItemDetail({ space, item }: { space: Space; item: SpaceItem }) {
  const queryClient = useQueryClient();
  const { data: templates = [] } = useQuery({
    queryKey: ['item-templates'],
    queryFn: listItemTemplates,
  });
  const typeName = templates.find(t => t.id === item.type)?.name ?? item.type;

  const [blocks, setBlocks] = useState(item.page_blocks);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Block[] | null>(null);
  useEffect(() => {
    if (!saveTimerRef.current) setBlocks(item.page_blocks);
  }, [item.id, item.page_blocks]);

  const saveMutation = useMutation({
    mutationFn: (updated: Block[]) => updateSpaceItem(space.id, item.id, { page_blocks: updated }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['space-items', space.id] }),
  });

  // Flush any pending save on unmount so navigating away doesn't silently drop changes
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        if (pendingSaveRef.current) {
          saveMutation.mutate(pendingSaveRef.current);
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schedulesSave = useCallback((next: Block[]) => {
    pendingSaveRef.current = next;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      pendingSaveRef.current = null;
      saveMutation.mutate(next);
    }, 800);
  }, [saveMutation]);

  const handleEdit = useCallback((index: number, updated: Block) => {
    setBlocks(prev => {
      const next = prev.map((b, i) => i === index ? updated : b);
      schedulesSave(next);
      return next;
    });
  }, [schedulesSave]);

  const handleDelete = useCallback((index: number) => {
    setBlocks(prev => {
      const next = prev.filter((_, i) => i !== index);
      schedulesSave(next);
      return next;
    });
  }, [schedulesSave]);

  const handleReorder = useCallback((fromIdx: number, toIdx: number) => {
    setBlocks(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      schedulesSave(next);
      return next;
    });
  }, [schedulesSave]);

  const addBlock = useCallback((block: Block) => {
    setBlocks(prev => {
      const next = [...prev, block];
      schedulesSave(next);
      return next;
    });
  }, [schedulesSave]);

  const draggingIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const fieldEntries = Object.entries(item.fields).filter(([, v]) => v !== null && v !== undefined && v !== '');
  const inlineFields = fieldEntries.filter(([, v]) => String(v).length <= 120);
  const longFields = fieldEntries.filter(([, v]) => String(v).length > 120);

  return (
    <PageBody>
      <ContentColumn className="max-w-4xl py-6">
        <div className="mb-5 flex items-center gap-2">
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground capitalize">
            {typeName}
          </span>
          {blocks.length > 0 && (
            <span className="text-[11px] text-faint-fg">{blocks.length} block{blocks.length === 1 ? '' : 's'}</span>
          )}
          {saveMutation.isPending && (
            <span className="text-[11px] text-faint-fg">· Saving…</span>
          )}
        </div>
        {inlineFields.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-border-soft bg-card px-4 py-3">
            {inlineFields.map(([key, value]) => (
              <div key={key} className="flex min-w-0 items-baseline gap-1.5">
                <span className="shrink-0 text-[11px] text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                <span className="min-w-0 truncate font-mono text-xs">{String(value)}</span>
              </div>
            ))}
          </div>
        )}
        {longFields.map(([key, value]) => (
          <div key={key} className="mb-5">
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</p>
            <div className="rounded-lg border border-border-soft bg-card px-4 py-3 text-[14px] leading-relaxed text-fg-soft
              [&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-foreground
              [&_h2]:mb-1 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground
              [&_h3]:mb-0.5 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground
              [&_p]:mb-3 [&_p:last-child]:mb-0
              [&_ul]:mb-3 [&_ul]:ml-5 [&_ul]:list-disc
              [&_ol]:mb-3 [&_ol]:ml-5 [&_ol]:list-decimal
              [&_li]:mb-1
              [&_hr]:my-4 [&_hr]:border-border-soft
              [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]
              [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border-soft [&_pre]:bg-muted/30 [&_pre]:p-3">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{String(value)}</ReactMarkdown>
            </div>
          </div>
        ))}
        {blocks.length === 0 && longFields.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-background/50 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">No content yet. Ask the agent to fill this in, or add a block below.</p>
            <BlockInserter spaceId={space.id} onAdd={addBlock} />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {blocks.map((block, i) => (
              <div
                key={i}
                className={cn(
                  'group relative flex items-start gap-2',
                  dragOverIdx === i && draggingIdxRef.current !== i && 'rounded-lg ring-2 ring-primary/30',
                )}
                onDragOver={(e) => { e.preventDefault(); setDragOverIdx(i); }}
                onDragLeave={() => setDragOverIdx(prev => prev === i ? null : prev)}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = draggingIdxRef.current;
                  if (from !== null && from !== i) handleReorder(from, i);
                  draggingIdxRef.current = null;
                  setDragOverIdx(null);
                }}
              >
                <div
                  draggable
                  onDragStart={() => { draggingIdxRef.current = i; }}
                  onDragEnd={() => { draggingIdxRef.current = null; setDragOverIdx(null); }}
                  className="mt-2.5 shrink-0 cursor-grab opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
                  title="Drag to reorder"
                >
                  <GripVertical size={14} className="text-faint-fg" />
                </div>
                <div className="min-w-0 flex-1">
                  <BlockRenderer
                    block={block}
                    spaceId={space.id}
                    itemId={item.id}
                    onEdit={(updated) => handleEdit(i, updated)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(i)}
                  title="Delete block"
                  className="mt-1.5 shrink-0 rounded-md p-1 opacity-0 transition-[opacity,colors] hover:bg-muted hover:text-destructive group-hover:opacity-100 text-muted-foreground/40"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <BlockInserter spaceId={space.id} onAdd={addBlock} />
          </div>
        )}
        <ItemFilesPanel spaceId={space.id} itemId={item.id} />
      </ContentColumn>
    </PageBody>
  );
}

function FileDetail({ space, item }: { space: Space; item: FileItem }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const { data: blob, isLoading, isError } = useQuery({
    queryKey: ['item-content', space.id, item.id],
    queryFn: () => getItemContent(space.id, item.id),
  });
  useEffect(() => {
    if (!blob) return;
    const mimeType = item.fields.mime_type as string | null | undefined;
    if (mimeType?.startsWith('text/') || mimeType === 'application/json') {
      blob.text().then(setText);
      return;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob, item.fields.mime_type]);

  return (
    <PageBody>
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-md bg-muted px-2 py-1">{(item.fields.mime_type as string | null) || 'Unknown type'}</span>
          {item.fields.size_bytes != null && <span>{formatBytes(item.fields.size_bytes as number)}</span>}
        </div>
        <Surface className="min-h-96 overflow-hidden">
          {isLoading && <div className="grid min-h-96 place-items-center text-sm text-muted-foreground">Loading file…</div>}
          {isError && <div className="grid min-h-96 place-items-center text-sm text-destructive">File content is unavailable.</div>}
          {text != null && <pre className="overflow-auto whitespace-pre-wrap p-5 font-mono text-xs leading-relaxed">{text}</pre>}
          {objectUrl && (item.fields.mime_type as string | undefined)?.startsWith('image/') && <img src={objectUrl} alt={item.name} className="mx-auto max-h-[70vh] object-contain p-4" />}
          {objectUrl && (item.fields.mime_type as string | undefined)?.startsWith('video/') && <video src={objectUrl} controls className="max-h-[70vh] w-full bg-black" />}
          {objectUrl && !(item.fields.mime_type as string | undefined)?.startsWith('image/') && !(item.fields.mime_type as string | undefined)?.startsWith('video/') && (
            <div className="grid min-h-96 place-items-center p-6 text-center">
              <div><File size={28} className="mx-auto text-muted-foreground" /><p className="mt-3 text-sm font-medium">{item.name}</p><a href={objectUrl} download={item.name} className="mt-3 inline-block text-sm text-on-accent-soft hover:underline">Download file</a></div>
            </div>
          )}
        </Surface>
      </div>
    </PageBody>
  );
}

type BlockEntry = { key: string; Icon: React.ElementType; label: string; desc: string; group: string };

const BLOCK_CATALOG: BlockEntry[] = [
  { key: 'text',     Icon: AlignLeft,        label: 'Text',          desc: 'Paragraph or markdown',       group: 'Content' },
  { key: 'heading',  Icon: Type,             label: 'Heading',       desc: 'H1, H2, or H3 title',         group: 'Content' },
  { key: 'code',     Icon: Code2,            label: 'Code',          desc: 'Syntax-highlighted snippet',  group: 'Content' },
  { key: 'callout',  Icon: MessageSquare,    label: 'Callout',       desc: 'Info, tip, or warning box',   group: 'Content' },
  { key: 'list',     Icon: ListOrdered,      label: 'List',          desc: 'Bullet or numbered list',     group: 'Content' },
  { key: 'task',     Icon: ListChecks,       label: 'Task list',     desc: 'Checkboxes with progress',    group: 'Content' },
  { key: 'input',    Icon: SlidersHorizontal, label: 'Input',        desc: 'User-fillable text field',    group: 'Interactive' },
  { key: 'relation', Icon: Link2,            label: 'Relation',      desc: 'Link to another item',        group: 'Links' },
];

function makeBlock(key: string): Block {
  switch (key) {
    case 'text':     return { type: 'text', content: '' };
    case 'heading':  return { type: 'heading', level: 2, text: '' };
    case 'code':     return { type: 'code', language: 'plaintext', content: '' };
    case 'callout':  return { type: 'callout', variant: 'info', content: '' };
    case 'list':     return { type: 'list', ordered: false, items: [''] };
    case 'task':     return { type: 'task-list', tasks: [] };
    case 'input':    return { type: 'input', label: 'Label', value: '', input_type: 'text' };
    default:         return { type: 'text', content: '' };
  }
}

function BlockInserter({ spaceId, onAdd }: { spaceId: string; onAdd: (block: Block) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [step, setStep] = useState<'types' | 'relation'>('types');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: spaceItems = [] } = useQuery<SpaceItem[]>({
    queryKey: ['space-items', spaceId],
    queryFn: () => getSpaceItems(spaceId),
    enabled: open && step === 'relation',
  });

  const q = query.trim().toLowerCase();
  const filteredTypes = BLOCK_CATALOG.filter(b =>
    !q || b.label.toLowerCase().includes(q) || b.desc.toLowerCase().includes(q)
  );
  const filteredItems = spaceItems.filter(item =>
    !q || item.name.toLowerCase().includes(q)
  );

  const activeList = step === 'types' ? filteredTypes : filteredItems;

  function openPalette() {
    setOpen(true);
    setQuery('');
    setStep('types');
    setHighlighted(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function close() {
    setOpen(false);
    setQuery('');
    setStep('types');
  }

  function selectType(key: string) {
    if (key === 'relation') {
      setStep('relation');
      setQuery('');
      setHighlighted(0);
      return;
    }
    onAdd(makeBlock(key));
    close();
  }

  function selectItem(item: SpaceItem) {
    onAdd({ type: 'relation', item_id: item.id, space_id: spaceId, label: item.name });
    close();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, activeList.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (step === 'types') { const b = filteredTypes[highlighted]; if (b) selectType(b.key); }
      else { const item = filteredItems[highlighted]; if (item) selectItem(item); }
    }
    else if (e.key === 'Escape') close();
    else if (e.key === 'Backspace' && !query && step === 'relation') { setStep('types'); setHighlighted(0); }
  }

  const groups = step === 'types'
    ? Array.from(new Set(filteredTypes.map(b => b.group)))
    : [];

  return (
    <Popover open={open} onOpenChange={o => { if (!o) close(); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={openPalette}
          className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-[11px] text-faint-fg transition-colors hover:bg-muted hover:text-muted-foreground"
        >
          <Plus size={11} />Add block
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-64 p-0 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border-soft px-3 py-2">
          {step === 'relation' && (
            <button type="button" onClick={() => { setStep('types'); setQuery(''); setHighlighted(0); }} className="shrink-0 text-faint-fg hover:text-muted-foreground">
              <ChevronRight size={12} className="rotate-180" />
            </button>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setHighlighted(0); }}
            onKeyDown={onKeyDown}
            placeholder={step === 'relation' ? 'Search items…' : 'Search blocks…'}
            className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-faint-fg"
          />
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {step === 'types' ? (
            groups.map(group => (
              <div key={group}>
                <p className="px-3 pb-0.5 pt-2 text-[10px] font-semibold text-faint-fg">{group}</p>
                {filteredTypes.filter(b => b.group === group).map((b, i) => {
                  const globalIdx = filteredTypes.indexOf(b);
                  return (
                    <button
                      key={b.key}
                      type="button"
                      onMouseEnter={() => setHighlighted(globalIdx)}
                      onClick={() => selectType(b.key)}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                        highlighted === globalIdx ? 'bg-muted' : 'hover:bg-muted/50'
                      )}
                    >
                      <div className="grid size-7 shrink-0 place-items-center rounded-md border border-border-soft bg-background">
                        <b.Icon size={13} className="text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-foreground">{b.label}</p>
                        <p className="text-[11px] text-faint-fg">{b.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))
          ) : (
            filteredItems.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-faint-fg">No items in this space</p>
            ) : filteredItems.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => selectItem(item)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                  highlighted === i ? 'bg-muted' : 'hover:bg-muted/50'
                )}
              >
                <div className="grid size-7 shrink-0 place-items-center rounded-md border border-border-soft bg-background">
                  <Link2 size={12} className="text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">{item.name}</p>
                  <p className="text-[11px] text-faint-fg capitalize">{item.type}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ItemIcon({ type, size = 8 }: { type: string; size?: number }) {
  const configs: Record<string, { icon: ReactNode; className: string }> = {
    repo:   { icon: <FolderGit2 size={15} />,    className: 'bg-blue-500/10 text-blue-400' },
    file:   { icon: <FileText size={15} />,       className: 'bg-amber-500/10 text-amber-400' },
    Chat:   { icon: <MessageSquare size={14} />,  className: 'bg-violet-500/10 text-violet-400' },
    kanban: { icon: <LayoutDashboard size={14} />, className: 'bg-cyan-500/10 text-cyan-400' },
  };
  const cfg = configs[type];
  const sizeClass = size === 7 ? 'size-7' : size === 9 ? 'size-9' : 'size-8';
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-lg', sizeClass, cfg?.className ?? 'bg-emerald-500/10 text-emerald-400')}>
      {cfg?.icon ?? <FileType size={14} />}
    </span>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function SpaceTabs({ spaceId, section }: { spaceId: string; section: Section }) {
  const navigate = useNavigate();
  const tabs: { label: string; key: Section }[] = [
    { label: 'Overview', key: 'overview' },
    { label: 'Chats', key: 'chats' },
    { label: 'Items', key: 'items' },
    { label: 'Settings', key: 'settings' },
  ];
  return (
    <div className="px-5 py-3">
      <div className="mx-auto w-full max-w-4xl">
        <TabStrip
          tabs={tabs}
          activeKey={section}
          ariaLabel="Space sections"
          onSelect={tab => navigate(tab.key === 'overview' ? `/spaces/${spaceId}` : `/spaces/${spaceId}/${tab.key}`)}
          renderTab={(tab, isActive) => (
            <Link
              key={tab.key}
              to={tab.key === 'overview' ? `/spaces/${spaceId}` : `/spaces/${spaceId}/${tab.key}`}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'inline-flex h-full items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition-all',
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          )}
        />
      </div>
    </div>
  );
}
