import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { subscribe } from '../lib/ws.js';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileText,
  FolderGit2,
  GitBranch,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  createChat,
  deleteSpace,
  getChats,
  getConnections,
  getSpaces,
  updateChatConfig,
  updateSpace,
  getDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  getProjects,
  createProject,
  linkProject,
  deleteProject,
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
import { ContentColumn, EmptyPanel, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import { TabStrip } from '@/components/ui/tab-strip';
import FileBrowser from '../components/FileBrowser.js';
import DocumentView from '../components/DocumentView.js';
import TriggersSection from '../components/TriggersSection.js';
import type { Connection, Document, DocumentWithBody, Project, Session, Space, WSEvent, WSSessionEventCreated } from '../types.js';

type Section = 'overview' | 'documents' | 'projects' | 'triggers' | 'chats' | 'settings';

function sectionFromPath(pathname: string, spaceId: string): Section {
  const suffix = pathname.slice(`/spaces/${spaceId}`.length).split('/').filter(Boolean)[0];
  const sections = ['chats', 'documents', 'projects', 'triggers', 'settings'] as const;
  type KnownSection = typeof sections[number];
  return (sections as readonly string[]).includes(suffix)
    ? suffix as KnownSection
    : 'overview';
}

export default function SpacePage() {
  const { spaceId, docId, projectId } = useParams<{ spaceId: string; docId?: string; projectId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const section = sectionFromPath(location.pathname, spaceId!);

  const { data: spaces = [], isLoading } = useQuery<Space[]>({ queryKey: ['spaces'], queryFn: getSpaces });
  const space = spaces.find(candidate => candidate.id === spaceId) ?? null;

  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ['documents', spaceId],
    queryFn: () => getDocuments(spaceId!),
    enabled: !!spaceId,
  });

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ['projects', spaceId],
    queryFn: () => getProjects(spaceId!),
    enabled: !!spaceId,
  });

  const { data: chats = [] } = useQuery<Session[]>({ queryKey: ['chats'], queryFn: () => getChats() });
  const spaceChats = chats.filter(chat => chat.pinned_space_id === spaceId);

  usePageTitle(space?.name);

  const startChat = useMutation({
    mutationFn: async () => {
      const created = await createChat();
      await updateChatConfig(created.id, { pinned_space_id: spaceId! });
      return created.id;
    },
    onSuccess: id => navigate(`/c/${id}`),
  });

  // Invalidate documents/projects in real-time when the agent creates or updates them
  useEffect(() => {
    return subscribe((event: WSEvent) => {
      if (event.type === 'session_event_created') {
        const ev = event as WSSessionEventCreated;
        if (
          (ev.event.type === 'document_created' || ev.event.type === 'document_updated') &&
          ev.event.space_id === spaceId
        ) {
          queryClient.invalidateQueries({ queryKey: ['documents', spaceId] });
        }
        if (ev.event.type === 'project_created' && ev.event.space_id === spaceId) {
          queryClient.invalidateQueries({ queryKey: ['projects', spaceId] });
        }
      }
    });
  }, [spaceId, queryClient]);

  if (isLoading) return <PageShell><PageLoading rows={4} /></PageShell>;
  if (!space) return <PageShell><PageHeader title="Space not found" /></PageShell>;

  // Detail views (no tab bar)
  if (docId) {
    return <DocumentDetail space={space} docId={docId} />;
  }
  if (projectId) {
    if (projectsLoading) return <PageShell><PageLoading rows={4} /></PageShell>;
    const project = projects.find(p => p.id === projectId) ?? null;
    return project
      ? <ProjectDetail space={space} project={project} />
      : <PageShell><PageHeader title="Project not found" /></PageShell>;
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
      {section === 'overview' && <Overview space={space} documents={documents} projects={projects} chats={spaceChats} onNewChat={() => startChat.mutate()} />}
      {section === 'chats' && <ChatsSection chats={spaceChats} onNewChat={() => startChat.mutate()} />}
      {section === 'documents' && <DocumentsSection space={space} documents={documents} />}
      {section === 'projects' && <ProjectsSection space={space} projects={projects} />}
      {section === 'triggers' && <PageBody><ContentColumn className="max-w-4xl"><TriggersSection spaceId={spaceId!} /></ContentColumn></PageBody>}
      {section === 'settings' && <SettingsSection space={space} />}
    </PageShell>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────

function OverviewCard({ icon, title, subtitle, badge, href }: { icon: ReactNode; title: string; subtitle: string; badge?: ReactNode; href: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(href)}
      className="flex w-full items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        <span className="block text-[11px] text-faint-fg">{subtitle}</span>
      </span>
      {badge}
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

function Overview({ space, documents, projects, chats, onNewChat }: {
  space: Space;
  documents: Document[];
  projects: Project[];
  chats: Session[];
  onNewChat: () => void;
}) {
  const navigate = useNavigate();
  const recentDocs = [...documents].sort((a, b) => b.updated_at - a.updated_at).slice(0, 5);
  const recentProjects = [...projects].sort((a, b) => b.created_at - a.created_at).slice(0, 5);
  const recentChats = [...chats].sort((a, b) => b.updated_at - a.updated_at).slice(0, 5);
  const isEmpty = documents.length === 0 && projects.length === 0 && chats.length === 0;

  return (
    <PageBody>
      <ContentColumn className="flex max-w-4xl flex-col gap-8 py-6">
        {isEmpty ? (
          <EmptyPanel
            title="Nothing here yet"
            description="Start a chat pinned to this space, or add a document or project."
            action={(
              <div className="flex gap-2">
                <Button size="sm" className="gap-1.5" onClick={onNewChat}>
                  <MessageSquare size={13} />Start chat
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(`/spaces/${space.id}/documents`)}>
                  <Plus size={13} />Add document
                </Button>
              </div>
            )}
          />
        ) : (
          <>
            {recentDocs.length > 0 && (
              <OverviewSection
                label="Documents"
                action={<button type="button" onClick={() => navigate(`/spaces/${space.id}/documents`)} className="text-[11px] text-faint-fg hover:text-muted-foreground">View all →</button>}
              >
                {recentDocs.map(doc => (
                  <OverviewCard
                    key={doc.id}
                    icon={<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400"><FileText size={14} /></span>}
                    title={doc.title}
                    subtitle={[doc.type, timeAgo(doc.updated_at)].filter(Boolean).join(' · ')}
                    badge={<StatusBadge status={doc.status} />}
                    href={`/spaces/${space.id}/documents/${doc.id}`}
                  />
                ))}
              </OverviewSection>
            )}
            {recentProjects.length > 0 && (
              <OverviewSection
                label="Projects"
                action={<button type="button" onClick={() => navigate(`/spaces/${space.id}/projects`)} className="text-[11px] text-faint-fg hover:text-muted-foreground">View all →</button>}
              >
                {recentProjects.map(project => (
                  <OverviewCard
                    key={project.id}
                    icon={<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-400"><FolderGit2 size={15} /></span>}
                    title={project.name}
                    subtitle={project.repo_path}
                    href={`/spaces/${space.id}/projects/${project.id}`}
                  />
                ))}
              </OverviewSection>
            )}
            {recentChats.length > 0 && (
              <OverviewSection
                label="Chats"
                action={<button type="button" onClick={() => navigate(`/spaces/${space.id}/chats`)} className="text-[11px] text-faint-fg hover:text-muted-foreground">View all →</button>}
              >
                {recentChats.map(chat => (
                  <OverviewCard
                    key={chat.id}
                    icon={<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-400"><MessageSquare size={14} /></span>}
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

// ─── Chats ───────────────────────────────────────────────────────────────────

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

// ─── Documents ───────────────────────────────────────────────────────────────

const STATUS_SUCCESS = /offer|accept|approv|done|complet|hired|won/i;
const STATUS_ERROR   = /reject|fail|declin|denied|lost|cancel/i;
const STATUS_WARNING = /interview|screen|review|pending|wait|hold/i;
const STATUS_INFO    = /apply|appli|submit|open|new/i;

function statusColor(status: string): string {
  if (STATUS_SUCCESS.test(status)) return 'bg-emerald-500/10 text-emerald-500';
  if (STATUS_ERROR.test(status))   return 'bg-red-500/10 text-red-500';
  if (STATUS_WARNING.test(status)) return 'bg-amber-500/10 text-amber-600';
  if (STATUS_INFO.test(status))    return 'bg-sky-500/10 text-sky-500';
  return 'bg-muted text-muted-foreground';
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize', statusColor(status))}>
      {status}
    </span>
  );
}

function DocumentsSection({ space, documents }: { space: Space; documents: Document[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('');
  const [newPath, setNewPath] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Document | null>(null);

  const types = [...new Set(documents.map(d => d.type).filter((t): t is string => t !== null))];

  const filtered = typeFilter === 'all' ? documents : documents.filter(d => d.type === typeFilter);
  const visible = search.trim()
    ? filtered.filter(d => d.title.toLowerCase().includes(search.trim().toLowerCase()))
    : filtered;
  const createMutation = useMutation({
    mutationFn: () => createDocument(space.id, {
      path: newPath.trim() || `${newTitle.trim().toLowerCase().replace(/\s+/g, '-')}.md`,
      title: newTitle.trim(),
      frontmatter: newType ? { type: newType } : {},
      body: '',
    }),
    onSuccess: doc => {
      queryClient.invalidateQueries({ queryKey: ['documents', space.id] });
      setDialogOpen(false);
      setNewTitle('');
      setNewType('');
      setNewPath('');
      navigate(`/spaces/${space.id}/documents/${doc.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => deleteDocument(space.id, docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', space.id] });
      setPendingDelete(null);
    },
  });

  return (
    <PageBody>
      <ContentColumn className="max-w-4xl">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Select value={typeFilter} onValueChange={v => setTypeFilter(v)}>
            <SelectTrigger size="sm" className="h-8 w-32 text-xs capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint-fg pointer-events-none" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search documents…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setDialogOpen(true)}>
            <Plus size={14} />Add document
          </Button>
        </div>

        {visible.length === 0 ? (
          <EmptyPanel
            title={documents.length === 0 ? 'No documents yet' : 'No results'}
            description="Add a markdown document to this Space."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map(doc => (
              <div key={doc.id} className="group flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3 transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm">
                <button
                  type="button"
                  onClick={() => navigate(`/spaces/${space.id}/documents/${doc.id}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">
                    <FileText size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{doc.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-faint-fg">
                      {[doc.type, timeAgo(doc.updated_at)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <StatusBadge status={doc.status} />
                  <ChevronRight size={14} className="shrink-0 text-faint-fg" />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100">
                      <MoreHorizontal size={14} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(doc)}>
                      <Trash2 size={14} />Delete
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
            <DialogTitle>Add Document</DialogTitle>
            <DialogDescription>Create a new markdown document in this Space.</DialogDescription>
          </DialogHeader>
          <Input placeholder="Title" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
          <Input placeholder="Type (optional, e.g. workflow, application)" value={newType} onChange={e => setNewType(e.target.value)} />
          <Input placeholder="Path (optional, e.g. docs/notes.md)" value={newPath} onChange={e => setNewPath(e.target.value)} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!newTitle.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.title}?`}
          description="This removes the document from the Space."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </PageBody>
  );
}

function DocumentDetail({ space, docId }: { space: Space; docId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [frontmatterDraft, setFrontmatterDraft] = useState<{ [key: string]: string }>({});

  const { data: doc, isLoading } = useQuery<DocumentWithBody>({
    queryKey: ['document', space.id, docId],
    queryFn: () => getDocument(space.id, docId),
  });

  useEffect(() => {
    if (doc) {
      setFrontmatterDraft(
        Object.fromEntries(
          Object.entries(doc.frontmatter)
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => [k, String(v)]),
        ),
      );
    }
  }, [doc]);

  const deleteMutation = useMutation({
    mutationFn: () => deleteDocument(space.id, docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', space.id] });
      navigate(`/spaces/${space.id}/documents`);
    },
  });

  if (isLoading) return <PageShell><PageLoading rows={4} /></PageShell>;
  if (!doc) return <PageShell><PageHeader title="Document not found" /></PageShell>;

  const frontmatterEntries = Object.entries(doc.frontmatter).filter(([, v]) => v !== null && v !== undefined && v !== '');

  return (
    <PageShell>
      <PageHeader
        title={doc.title}
        className="border-0 pb-0"
        contentClassName="max-w-4xl"
        breadcrumb={(
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => navigate(`/spaces/${space.id}/documents`)}
          >
            <ArrowLeft size={13} />Documents
          </Button>
        )}
        actions={(
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm"><MoreHorizontal size={15} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2 size={14} />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />
      <PageBody>
        <ContentColumn className="max-w-4xl py-6">
          {frontmatterEntries.length > 0 && (
            <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-border-soft bg-card px-4 py-3">
              {frontmatterEntries.map(([key]) => (
                <div key={key} className="flex min-w-0 items-baseline gap-1.5">
                  <span className="shrink-0 text-[11px] text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                  <input
                    className="min-w-0 truncate bg-transparent font-mono text-xs focus:outline-none"
                    value={frontmatterDraft[key] ?? ''}
                    onChange={e => setFrontmatterDraft(prev => ({ ...prev, [key]: e.target.value }))}
                    onBlur={e => {
                      const newVal = e.target.value;
                      const original = String(doc.frontmatter[key] ?? '');
                      if (newVal !== original) {
                        updateDocument(space.id, doc.id, { frontmatter: { [key]: newVal } }).then(() => {
                          queryClient.invalidateQueries({ queryKey: ['document', space.id, docId] });
                        });
                      }
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          <DocumentView
            spaceId={space.id}
            doc={doc}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ['document', space.id, docId] })}
          />
        </ContentColumn>
      </PageBody>
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${doc.title}?`}
          description="This removes the document from the Space."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </PageShell>
  );
}

// ─── Projects ────────────────────────────────────────────────────────────────

function ProjectsSection({ space, projects }: { space: Space; projects: Project[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [branch, setBranch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createProject(space.id, { name: name.trim() }),
    onSuccess: project => {
      queryClient.invalidateQueries({ queryKey: ['projects', space.id] });
      setCreateOpen(false);
      setName('');
      navigate(`/spaces/${space.id}/projects/${project.id}`);
    },
  });

  const linkMutation = useMutation({
    mutationFn: () => linkProject(space.id, {
      name: name.trim(),
      repo_path: repoPath.trim(),
      ...(branch.trim() ? { default_branch: branch.trim() } : {}),
    }),
    onSuccess: project => {
      queryClient.invalidateQueries({ queryKey: ['projects', space.id] });
      setLinkOpen(false);
      setName('');
      setRepoPath('');
      setBranch('');
      navigate(`/spaces/${space.id}/projects/${project.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (projectId: string) => deleteProject(space.id, projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', space.id] });
      setPendingDelete(null);
    },
  });

  return (
    <PageBody>
      <ContentColumn className="max-w-4xl">
        <div className="mb-5 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => { setName(''); setRepoPath(''); setBranch(''); setLinkOpen(true); }}
          >
            Link project
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => { setName(''); setCreateOpen(true); }}
          >
            <Plus size={14} />Create project
          </Button>
        </div>

        {projects.length === 0 ? (
          <EmptyPanel title="No projects yet" description="Create or link a git repository to this Space." />
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map(project => (
              <div key={project.id} className="group flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3 transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm">
                <button
                  type="button"
                  onClick={() => navigate(`/spaces/${space.id}/projects/${project.id}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-400">
                    <FolderGit2 size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{project.name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-faint-fg">{project.repo_path}</span>
                  </span>
                  <ChevronRight size={14} className="shrink-0 text-faint-fg" />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100">
                      <MoreHorizontal size={14} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(project)}>
                      <Trash2 size={14} />Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </ContentColumn>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
            <DialogDescription>Initialize a new project in this Space.</DialogDescription>
          </DialogHeader>
          <Input placeholder="Project name" value={name} onChange={e => setName(e.target.value)} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={!name.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Project</DialogTitle>
            <DialogDescription>Link an existing git repository to this Space.</DialogDescription>
          </DialogHeader>
          <Input placeholder="Project name" value={name} onChange={e => setName(e.target.value)} />
          <Input placeholder="/absolute/path/to/repo" value={repoPath} onChange={e => setRepoPath(e.target.value)} />
          <Input placeholder="Default branch (optional)" value={branch} onChange={e => setBranch(e.target.value)} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button
              disabled={!name.trim() || !repoPath.trim() || linkMutation.isPending}
              onClick={() => linkMutation.mutate()}
            >
              Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.name}?`}
          description="This removes the project from the Space."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </PageBody>
  );
}

function ProjectDetail({ space, project }: { space: Space; project: Project }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(space.id, project.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', space.id] });
      navigate(`/spaces/${space.id}/projects`);
    },
  });

  return (
    <PageShell>
      <PageHeader
        title={project.name}
        className="border-0 pb-0"
        contentClassName="max-w-4xl"
        breadcrumb={(
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => navigate(`/spaces/${space.id}/projects`)}
          >
            <ArrowLeft size={13} />Projects
          </Button>
        )}
        actions={(
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm"><MoreHorizontal size={15} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2 size={14} />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />
      <PageBody className="p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3">
          <GitBranch size={15} className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{project.repo_path}</span>
          {project.default_branch && (
            <span className="rounded-md bg-muted px-2 py-1 font-mono text-[11px]">{project.default_branch}</span>
          )}
        </div>
        <FileBrowser spaceId={space.id} projectId={project.id} projectName={project.name} />
      </PageBody>
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${project.name}?`}
          description="This removes the project from the Space."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </PageShell>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────

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
            <div><div className="text-sm font-medium">Delete Space</div><div className="mt-0.5 text-xs text-muted-foreground">Permanently removes its documents and links.</div></div>
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

// ─── Tab strip ───────────────────────────────────────────────────────────────

function SpaceTabs({ spaceId, section }: { spaceId: string; section: Section }) {
  const navigate = useNavigate();
  const tabs: { label: string; key: Section }[] = [
    { label: 'Overview', key: 'overview' },
    { label: 'Chats', key: 'chats' },
    { label: 'Documents', key: 'documents' },
    { label: 'Projects', key: 'projects' },
    { label: 'Triggers', key: 'triggers' },
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
