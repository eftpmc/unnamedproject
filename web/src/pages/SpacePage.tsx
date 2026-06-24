import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft,
  Boxes,
  Check,
  ChevronRight,
  File,
  FileText,
  FolderGit2,
  GitBranch,
  ListTodo,
  MessageSquare,
  MoreHorizontal,
  NotebookPen,
  Play,
  Plus,
  Trash2,
  Workflow,
} from 'lucide-react';
import {
  createChat,
  createSpaceItem,
  deleteSpace,
  deleteSpaceItem,
  deleteSpacePipeline,
  getChats,
  getItemContent,
  getSpaceItems,
  getSpacePipelines,
  getSpacePlans,
  getSpaces,
  runSpacePipeline,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyPanel, PageBody, PageHeader, PageLoading, PageSection, PageShell, Surface } from '@/components/ui/app-layout';
import { StatusPill } from '@/components/ui/status-pill';
import FileBrowser from '../components/FileBrowser.js';
import type { Pipeline, Plan, Session, Space, SpaceItem, SpaceItemType } from '../types.js';

type Section = 'overview' | 'chats' | 'items' | 'plans' | 'pipelines' | 'settings';

function sectionFromPath(pathname: string, spaceId: string): Section {
  const suffix = pathname.slice(`/spaces/${spaceId}`.length).split('/').filter(Boolean)[0];
  return ['chats', 'items', 'plans', 'pipelines', 'settings'].includes(suffix) ? suffix as Section : 'overview';
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
  const { data: plans = [] } = useQuery({
    queryKey: ['space-plans', spaceId],
    queryFn: () => getSpacePlans(spaceId!),
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

  if (isLoading) return <PageShell><PageLoading rows={4} /></PageShell>;
  if (!space) {
    return <PageShell><PageHeader title="Space not found" /></PageShell>;
  }

  if (itemId) {
    return currentItem
      ? <ItemDetail space={space} item={currentItem} />
      : <PageShell><PageHeader title="Item not found" /></PageShell>;
  }

  const title = section === 'overview' ? space.name : section[0].toUpperCase() + section.slice(1);
  const description = section === 'overview' ? space.description || 'Everything related to this work, in one place.' : undefined;

  return (
    <PageShell>
      <PageHeader
        title={title}
        description={description}
        breadcrumb={section === 'overview' ? undefined : (
          <Link to={`/spaces/${space.id}`} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
            {space.name}
          </Link>
        )}
        actions={section !== 'settings' ? (
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => startChat.mutate()} disabled={startChat.isPending}>
            <MessageSquare size={14} />
            New chat
          </Button>
        ) : undefined}
      />
      {section === 'overview' && <Overview space={space} items={items} plans={plans} chats={spaceChats} />}
      {section === 'chats' && <ChatsSection chats={spaceChats} onNewChat={() => startChat.mutate()} />}
      {section === 'items' && <ItemsSection space={space} items={items} />}
      {section === 'plans' && <PlansSection space={space} plans={plans} items={items} />}
      {section === 'pipelines' && <PipelinesSection space={space} />}
      {section === 'settings' && <SettingsSection space={space} />}
    </PageShell>
  );
}

function Overview({ space, items, plans, chats }: { space: Space; items: SpaceItem[]; plans: Plan[]; chats: Session[] }) {
  const navigate = useNavigate();
  const activePlans = plans.filter(plan => plan.status === 'running');
  const recent = [
    ...plans.slice(0, 4).map(plan => ({ key: plan.id, type: 'Plan', title: plan.title, time: plan.created_at, href: `/spaces/${space.id}/plans/${plan.id}`, status: plan.status })),
    ...chats.slice(0, 4).map(chat => ({ key: chat.id, type: 'Chat', title: chat.title ?? 'Untitled chat', time: chat.updated_at, href: `/c/${chat.id}`, status: null })),
    ...items.slice(0, 4).map(item => ({ key: item.id, type: item.type, title: item.name, time: item.created_at, href: `/spaces/${space.id}/items/${item.id}`, status: null })),
  ].sort((a, b) => b.time - a.time).slice(0, 6);

  return (
    <PageBody>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-7">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Metric label="Items" value={items.length} onClick={() => navigate(`/spaces/${space.id}/items`)} />
          <Metric label="Chats" value={chats.length} onClick={() => navigate(`/spaces/${space.id}/chats`)} />
          <Metric label="Plans" value={plans.length} onClick={() => navigate(`/spaces/${space.id}/plans`)} />
          <Metric label="Running" value={activePlans.length} />
        </div>

        {activePlans.length > 0 && (
          <PageSection title="Active now">
            <div className="grid gap-3 md:grid-cols-2">
              {activePlans.map(plan => <PlanCard key={plan.id} plan={plan} spaceId={space.id} />)}
            </div>
          </PageSection>
        )}

        <PageSection title="Recent activity">
          {recent.length === 0 ? (
            <EmptyPanel title="Nothing here yet" description="Start a chat or add an Item to begin building this Space." />
          ) : (
            <Surface className="divide-y divide-border-soft overflow-hidden">
              {recent.map(entry => (
                <button
                  type="button"
                  key={`${entry.type}-${entry.key}`}
                  onClick={() => navigate(entry.href)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/35"
                >
                  <ItemIcon type={entry.type === 'Plan' || entry.type === 'Chat' ? entry.type : entry.type as SpaceItemType} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{entry.title}</span>
                    <span className="mt-0.5 block text-xs capitalize text-muted-foreground">{entry.type} · {timeAgo(entry.time)}</span>
                  </span>
                  {entry.status && <StatusPill status={entry.status as Plan['status']} />}
                  <ChevronRight size={15} className="text-faint-fg" />
                </button>
              ))}
            </Surface>
          )}
        </PageSection>
      </div>
    </PageBody>
  );
}

function Metric({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  const content = <><div className="text-2xl font-semibold tracking-tight">{value}</div><div className="mt-1 text-xs text-muted-foreground">{label}</div></>;
  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-lg border border-border-soft bg-card p-4 text-left transition hover:border-border hover:shadow-sm">
      {content}
    </button>
  ) : <Surface className="p-4">{content}</Surface>;
}

function ChatsSection({ chats, onNewChat }: { chats: Session[]; onNewChat: () => void }) {
  const navigate = useNavigate();
  return (
    <PageBody>
      <div className="mx-auto max-w-4xl">
        {chats.length === 0 ? (
          <EmptyPanel title="No chats yet" description="Chats started from this Space stay connected to its context." action={<Button size="sm" onClick={onNewChat}>Start chat</Button>} />
        ) : (
          <Surface className="divide-y divide-border-soft overflow-hidden">
            {chats.map(chat => (
              <button key={chat.id} type="button" onClick={() => navigate(`/c/${chat.id}`)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/35">
                <MessageSquare size={15} className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{chat.title ?? 'Untitled chat'}</span>
                <span className="text-xs text-faint-fg">{timeAgo(chat.updated_at)}</span>
                <ChevronRight size={15} className="text-faint-fg" />
              </button>
            ))}
          </Surface>
        )}
      </div>
    </PageBody>
  );
}

function ItemsSection({ space, items }: { space: Space; items: SpaceItem[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | SpaceItemType>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [type, setType] = useState<SpaceItemType>('repo');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [pendingDelete, setPendingDelete] = useState<SpaceItem | null>(null);
  const visible = filter === 'all' ? items : items.filter(item => item.type === filter);

  const createMutation = useMutation({
    mutationFn: () => createSpaceItem(space.id, {
      type,
      name: name.trim(),
      ...(type === 'repo' ? { repo_path: value.trim() } : {}),
      ...(type === 'file' ? { file_path: value.trim() } : {}),
      ...(type === 'note' ? { content: value } : {}),
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
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {(['all', 'repo', 'file', 'note'] as const).map(candidate => (
              <button
                type="button"
                key={candidate}
                onClick={() => setFilter(candidate)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium capitalize text-muted-foreground transition-colors',
                  filter === candidate && 'bg-card text-foreground shadow-xs',
                )}
              >
                {candidate}
              </button>
            ))}
          </div>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setDialogOpen(true)}>
            <Plus size={14} />Add Item
          </Button>
        </div>

        {visible.length === 0 ? (
          <EmptyPanel title={items.length === 0 ? 'No Items yet' : `No ${filter} Items`} description="Add a repository, file reference, or note to this Space." />
        ) : (
          <Surface className="divide-y divide-border-soft overflow-hidden">
            {visible.map(item => (
              <div key={item.id} className="group flex items-center gap-3 px-4 py-3.5">
                <button type="button" onClick={() => navigate(`/spaces/${space.id}/items/${item.id}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <ItemIcon type={item.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {item.type === 'repo' ? item.repo_path : item.type === 'file' ? item.mime_type || item.file_path : 'Note'}
                      {item.source_plan_id ? ' · Generated by a plan' : ''}
                    </span>
                  </span>
                  <span className="text-xs text-faint-fg">{timeAgo(item.created_at)}</span>
                  <ChevronRight size={15} className="text-faint-fg" />
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
          </Surface>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Item</DialogTitle>
            <DialogDescription>Items are the durable contents of this Space.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(['repo', 'file', 'note'] as const).map(candidate => (
              <button
                key={candidate}
                type="button"
                onClick={() => { setType(candidate); setValue(''); }}
                className={cn('flex-1 rounded-md px-2 py-1.5 text-xs font-medium capitalize', type === candidate ? 'bg-card shadow-xs' : 'text-muted-foreground')}
              >
                {candidate}
              </button>
            ))}
          </div>
          <Input placeholder="Item name" value={name} onChange={event => setName(event.target.value)} />
          {type === 'note' ? (
            <textarea
              value={value}
              onChange={event => setValue(event.target.value)}
              rows={8}
              placeholder="Write a note…"
              className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          ) : (
            <Input
              value={value}
              onChange={event => setValue(event.target.value)}
              placeholder={type === 'repo' ? '/Users/you/code/repository' : '/absolute/path/to/file.pdf'}
            />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button disabled={!name.trim() || !value.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
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

function PlansSection({ space, plans, items }: { space: Space; plans: Plan[]; items: SpaceItem[] }) {
  const generatedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach(item => {
      if (item.source_plan_id) counts.set(item.source_plan_id, (counts.get(item.source_plan_id) ?? 0) + 1);
    });
    return counts;
  }, [items]);

  return (
    <PageBody>
      <div className="mx-auto max-w-5xl">
        {plans.length === 0 ? (
          <EmptyPanel title="No plans yet" description="Ask the agent to plan or execute a multi-step effort." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {plans.map(plan => <PlanCard key={plan.id} plan={plan} spaceId={space.id} generatedCount={generatedCounts.get(plan.id) ?? 0} />)}
          </div>
        )}
      </div>
    </PageBody>
  );
}

function PlanCard({ plan, spaceId, generatedCount = 0 }: { plan: Plan; spaceId: string; generatedCount?: number }) {
  return (
    <Link to={`/spaces/${spaceId}/plans/${plan.id}`}>
      <Surface interactive className="flex h-full items-start gap-3 p-4">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><ListTodo size={16} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{plan.title}</span><StatusPill status={plan.status} /></div>
          <div className="mt-1.5 text-xs text-muted-foreground">{generatedCount} generated Items · {timeAgo(plan.created_at)}</div>
        </div>
        <ChevronRight size={15} className="mt-1 text-faint-fg" />
      </Surface>
    </Link>
  );
}

function PipelinesSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [running, setRunning] = useState<Pipeline | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Pipeline | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['space-pipelines', space.id],
    queryFn: () => getSpacePipelines(space.id),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSpacePipeline(space.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-pipelines', space.id] });
      setPendingDelete(null);
    },
  });
  const runMutation = useMutation({
    mutationFn: (id: string) => runSpacePipeline(space.id, id),
    onSuccess: result => navigate(`/spaces/${space.id}/plans/${result.plan_id}`),
  });

  if (isLoading) return <PageLoading rows={3} />;
  const pipelines = data?.pipelines ?? [];
  return (
    <PageBody>
      <div className="mx-auto max-w-4xl">
        {pipelines.length === 0 ? (
          <EmptyPanel title="No pipelines yet" description="Pipelines are reusable workflows owned by this Space. Ask the agent to create one." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {pipelines.map(pipeline => (
              <Surface key={pipeline.id} className="group flex items-center gap-3 p-4">
                <div className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground"><Workflow size={16} /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{pipeline.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{pipeline.description || `${pipeline.task_count ?? 0} steps`}</div>
                </div>
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setRunning(pipeline)}><Play size={12} />Run</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm"><MoreHorizontal size={14} /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(pipeline)}><Trash2 size={14} />Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Surface>
            ))}
          </div>
        )}
      </div>

      {running && (
        <Dialog open onOpenChange={open => !open && setRunning(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Run pipeline</DialogTitle><DialogDescription>{running.title} will create a new plan in {space.name}.</DialogDescription></DialogHeader>
            {runMutation.isError && <p className="text-sm text-destructive">The pipeline could not be started.</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRunning(null)}>Cancel</Button>
              <Button disabled={runMutation.isPending} onClick={() => runMutation.mutate(running.id)}>{runMutation.isPending ? 'Starting…' : 'Run now'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.title}?`}
          description="Plans already created from this pipeline are not affected."
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

  return (
    <PageBody>
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
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
        <section className="flex items-center justify-between gap-4 rounded-lg border border-destructive/25 bg-destructive/5 p-4">
          <div><div className="text-sm font-medium">Delete Space</div><div className="mt-0.5 text-xs text-muted-foreground">Permanently removes its Items, plans, pipelines, and links.</div></div>
          <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
        </section>
      </div>
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

function ItemDetail({ space, item }: { space: Space; item: SpaceItem }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
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
        title={item.name}
        breadcrumb={(
          <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link to={`/spaces/${space.id}/items`} className="hover:text-foreground">Items</Link>
            <ChevronRight size={12} />
            <span className="text-foreground">{item.name}</span>
          </nav>
        )}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => navigate(`/spaces/${space.id}/items`)}>
              <ArrowLeft size={13} />Back
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm"><MoreHorizontal size={15} /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}><Trash2 size={14} />Delete Item</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      />
      {item.type === 'repo' && <RepoDetail space={space} item={item} />}
      {item.type === 'note' && <NoteDetail space={space} item={item} />}
      {item.type === 'file' && <FileDetail space={space} item={item} />}
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

function RepoDetail({ space, item }: { space: Space; item: SpaceItem & { type: 'repo' } }) {
  return (
    <PageBody className="p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3">
        <GitBranch size={15} className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{item.repo_path}</span>
        {item.default_branch && <span className="rounded-md bg-muted px-2 py-1 font-mono text-[11px]">{item.default_branch}</span>}
      </div>
      <FileBrowser spaceId={space.id} itemId={item.id} itemName={item.name} />
    </PageBody>
  );
}

function NoteDetail({ space, item }: { space: Space; item: SpaceItem & { type: 'note' } }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(item.content);
  useEffect(() => setContent(item.content), [item.content]);
  const updateMutation = useMutation({
    mutationFn: () => updateSpaceItem(space.id, item.id, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-items', space.id] });
      setEditing(false);
    },
  });

  return (
    <PageBody>
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex justify-end">
          {editing ? (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setContent(item.content); setEditing(false); }}>Cancel</Button>
              <Button size="sm" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate()}>{updateMutation.isPending ? 'Saving…' : 'Save note'}</Button>
            </div>
          ) : <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(true)}><NotebookPen size={14} />Edit</Button>}
        </div>
        <Surface className="min-h-96 p-5 sm:p-8">
          {editing ? (
            <textarea value={content} onChange={event => setContent(event.target.value)} className="min-h-[32rem] w-full resize-none bg-transparent font-mono text-[13px] leading-relaxed outline-none" autoFocus />
          ) : (
            <Markdown>{item.content}</Markdown>
          )}
        </Surface>
      </div>
    </PageBody>
  );
}

function FileDetail({ space, item }: { space: Space; item: SpaceItem & { type: 'file' } }) {
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
          {item.source_plan_id && <Link className="text-on-accent-soft hover:underline" to={`/spaces/${space.id}/plans/${item.source_plan_id}`}>Generated by plan</Link>}
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

function ItemIcon({ type }: { type: SpaceItemType | 'Plan' | 'Chat' }) {
  const icon: Record<string, ReactNode> = {
    repo: <FolderGit2 size={15} />,
    file: <FileText size={15} />,
    note: <NotebookPen size={15} />,
    Plan: <ListTodo size={15} />,
    Chat: <MessageSquare size={15} />,
  };
  return <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">{icon[type]}</span>;
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[14px] leading-relaxed text-fg-soft [&_h1]:mb-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:mb-4 [&_ul]:mb-4 [&_ul]:ml-5 [&_ul]:list-disc [&_ol]:mb-4 [&_ol]:ml-5 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
