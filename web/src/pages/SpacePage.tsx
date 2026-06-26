import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { subscribe } from '../lib/ws.js';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  File,
  FileText,
  FileType,
  FolderGit2,
  GitBranch,
  GripVertical,
  LayoutDashboard,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  createChat,
  createSpaceItem,
  deleteSpace,
  deleteSpaceItem,
  getChats,
  getConnections,
  getItemContent,
  getItemSessions,
  getSpaceItems,
  getSpaces,
  listItemTemplates,
  updateChatConfig,
  updateSpace,
  updateSpaceItem,
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
  const { data: chats = [] } = useQuery<Session[]>({ queryKey: ['chats'], queryFn: getChats });
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

function Overview({ space, items, chats, onNewChat }: { space: Space; items: SpaceItem[]; chats: Session[]; onNewChat: () => void }) {
  const navigate = useNavigate();
  const recent = [
    ...chats.map(chat => ({ key: chat.id, type: 'Chat' as const, title: chat.title ?? 'Untitled chat', time: chat.updated_at, href: `/c/${chat.id}` })),
    ...items.map(item => ({ key: item.id, type: item.type, title: item.name, time: item.created_at, href: `/spaces/${space.id}/items/${item.id}` })),
  ].sort((a, b) => b.time - a.time).slice(0, 12);

  return (
    <PageBody>
      <ContentColumn className="max-w-4xl">
        {recent.length === 0 ? (
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
          <div className="flex flex-col gap-2">
            {recent.map(entry => (
              <button
                type="button"
                key={`${entry.type}-${entry.key}`}
                onClick={() => navigate(entry.href)}
                className="flex w-full items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3.5 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <ItemIcon type={entry.type} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{entry.title}</span>
                  <span className="block text-xs capitalize text-faint-fg">{entry.type} · {timeAgo(entry.time)}</span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-faint-fg" />
              </button>
            ))}
          </div>
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
  if (item.type === 'repo') return (item as RepoItem).repo_path;
  if (item.type === 'file') return (item as FileItem).file_path;
  for (const block of item.page_blocks) {
    if (block.type === 'text' && block.content.trim()) return block.content.trim();
    if (block.type === 'heading' && block.text.trim()) return block.text.trim();
  }
  return null;
}

function ItemsSection({ space, items }: { space: Space; items: SpaceItem[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [type, setType] = useState<string>('blank');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [pendingDelete, setPendingDelete] = useState<SpaceItem | null>(null);
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
            {visible.map(item => (
              <div key={item.id} className="group flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3.5 transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm">
                <button type="button" onClick={() => navigate(`/spaces/${space.id}/items/${item.id}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none">
                  <ItemIcon type={item.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-faint-fg">
                      {itemPreview(item) ?? (templates.find(t => t.id === item.type)?.name ?? item.type)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-faint-fg">{timeAgo(item.created_at)}</span>
                  <ChevronRight size={15} className="shrink-0 text-faint-fg" />
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
            ))}
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
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{item.repo_path}</span>
        {item.default_branch && <span className="rounded-md bg-muted px-2 py-1 font-mono text-[11px]">{item.default_branch}</span>}
      </div>
      <FileBrowser spaceId={space.id} itemId={item.id} itemName={item.name} />
    </PageBody>
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
  useEffect(() => {
    if (!saveTimerRef.current) setBlocks(item.page_blocks);
  }, [item.id, item.page_blocks]);

  const saveMutation = useMutation({
    mutationFn: (updated: Block[]) => updateSpaceItem(space.id, item.id, { page_blocks: updated }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['space-items', space.id] }),
  });

  const schedulesSave = useCallback((next: Block[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
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

  return (
    <PageBody>
      <ContentColumn className="max-w-4xl py-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground capitalize">
            {typeName}
          </span>
          {saveMutation.isPending && (
            <span className="text-[11px] text-faint-fg">Saving…</span>
          )}
        </div>
        {blocks.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-background/50 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">No content yet. Ask the agent to fill this in, or add a block below.</p>
            <AddBlockButton onAdd={addBlock} />
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
            <AddBlockButton onAdd={addBlock} />
          </div>
        )}
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
    if (item.mime_type?.startsWith('text/') || item.mime_type === 'application/json') {
      blob.text().then(setText);
      return;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob, item.mime_type]);

  return (
    <PageBody>
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-md bg-muted px-2 py-1">{item.mime_type || 'Unknown type'}</span>
          {item.size_bytes != null && <span>{formatBytes(item.size_bytes)}</span>}
        </div>
        <Surface className="min-h-96 overflow-hidden">
          {isLoading && <div className="grid min-h-96 place-items-center text-sm text-muted-foreground">Loading file…</div>}
          {isError && <div className="grid min-h-96 place-items-center text-sm text-destructive">File content is unavailable.</div>}
          {text != null && <pre className="overflow-auto whitespace-pre-wrap p-5 font-mono text-xs leading-relaxed">{text}</pre>}
          {objectUrl && item.mime_type?.startsWith('image/') && <img src={objectUrl} alt={item.name} className="mx-auto max-h-[70vh] object-contain p-4" />}
          {objectUrl && item.mime_type?.startsWith('video/') && <video src={objectUrl} controls className="max-h-[70vh] w-full bg-black" />}
          {objectUrl && !item.mime_type?.startsWith('image/') && !item.mime_type?.startsWith('video/') && (
            <div className="grid min-h-96 place-items-center p-6 text-center">
              <div><File size={28} className="mx-auto text-muted-foreground" /><p className="mt-3 text-sm font-medium">{item.name}</p><a href={objectUrl} download={item.name} className="mt-3 inline-block text-sm text-on-accent-soft hover:underline">Download file</a></div>
            </div>
          )}
        </Surface>
      </div>
    </PageBody>
  );
}

const BLOCK_OPTIONS: { label: string; description: string; block: Block }[] = [
  { label: 'Text', description: 'Plain paragraph', block: { type: 'text', content: '' } },
  { label: 'Heading', description: 'Section title', block: { type: 'heading', level: 2, text: '' } },
  { label: 'Code', description: 'Code snippet', block: { type: 'code', language: 'plaintext', content: '' } },
  { label: 'Callout', description: 'Highlighted note', block: { type: 'callout', variant: 'info', content: '' } },
  { label: 'Bullet list', description: 'Unordered list', block: { type: 'list', ordered: false, items: [''] } },
  { label: 'Numbered list', description: 'Ordered list', block: { type: 'list', ordered: true, items: [''] } },
  { label: 'Task list', description: 'Checkboxes', block: { type: 'task-list', tasks: [] } },
  { label: 'Text input', description: 'Single-line field', block: { type: 'input', label: 'Label', value: '', input_type: 'text' } },
  { label: 'Long input', description: 'Multi-line field', block: { type: 'input', label: 'Label', value: '', input_type: 'multiline' } },
  { label: 'Number input', description: 'Numeric field', block: { type: 'input', label: 'Label', value: '', input_type: 'number' } },
  { label: 'Dropdown', description: 'Pick from options', block: { type: 'input', label: 'Label', value: '', input_type: 'select', options: ['Option 1', 'Option 2'] } },
];

function AddBlockButton({ onAdd }: { onAdd: (block: Block) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-[11px] text-faint-fg transition-colors hover:bg-muted hover:text-muted-foreground"
        >
          <Plus size={11} />Add block
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1.5">
        {BLOCK_OPTIONS.map(opt => (
          <button
            key={opt.label}
            type="button"
            onClick={() => { onAdd(opt.block); setOpen(false); }}
            className="flex w-full flex-col rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted"
          >
            <span className="text-xs font-medium text-foreground">{opt.label}</span>
            <span className="text-[11px] text-faint-fg">{opt.description}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ItemIcon({ type }: { type: string }) {
  const icon: Record<string, ReactNode> = {
    repo: <FolderGit2 size={15} />,
    file: <FileText size={15} />,
    Chat: <MessageSquare size={15} />,
    kanban: <LayoutDashboard size={15} />,
    // all block-based doc types get FileType; custom template IDs fall through too
  };
  return <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">{icon[type] ?? <FileType size={15} />}</span>;
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
