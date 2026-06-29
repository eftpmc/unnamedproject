import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FileText, GitBranch, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  getProject, updateProject, deleteTopLevelProject,
  getConnections, updateSpace, getSpaces, getChats, deleteChat, createChat, updateChatConfig,
  getDocuments, updateDocumentById, deleteDocumentById,
} from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { timeAgo } from '../lib/utils.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DataTable, DataTableBody, DataTableHeader, DataTableRow } from '@/components/ui/data-table';
import FileBrowser from '../components/FileBrowser.js';
import type { Connection, Document, Project, Session, Space } from '../types.js';

type SubRoute = 'overview' | 'files' | 'chats' | 'documents';

function subRoute(pathname: string, projectId: string): SubRoute {
  const suffix = pathname.slice(`/projects/${projectId}`.length).split('/').filter(Boolean)[0];
  if (suffix === 'files') return 'files';
  if (suffix === 'chats') return 'chats';
  if (suffix === 'documents') return 'documents';
  return 'overview';
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const view = subRoute(location.pathname, projectId!);

  const { data: project, isLoading } = useQuery<Project>({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  });

  usePageTitle(project?.name);

  if (isLoading) return <PageShell><PageLoading rows={4} /></PageShell>;
  if (!project) return <PageShell><PageHeader title="Project not found" /></PageShell>;

  if (view === 'files') {
    return (
      <PageShell>
        <PageHeader
          title={project.name}
          breadcrumb="Files"
          className="px-4 pt-6 sm:px-8 sm:pt-10"
          contentClassName="max-w-7xl"
          titleClassName="text-2xl sm:text-3xl"
        />
        <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
          <div className="mx-auto max-w-7xl">
            <FileBrowser projectId={project.id} projectName={project.name} />
          </div>
        </PageBody>
      </PageShell>
    );
  }

  if (view === 'chats') {
    return <ProjectChatsView project={project} />;
  }

  if (view === 'documents') {
    return <ProjectDocumentsView project={project} />;
  }

  // Overview (default)
  return (
    <ProjectOverview project={project} navigate={navigate} />
  );
}

function ProjectChatsView({ project }: { project: Project }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { data: allChats = [], isLoading } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: () => getChats(),
  });

  const chats = allChats.filter(c => c.pinned_space_id === project.space_id);

  const deleteMutation = useMutation({
    mutationFn: deleteChat,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setPendingDelete(null);
    },
    onError: () => setPendingDelete(null),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => updateChatConfig(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setRenaming(null);
    },
  });

  function startRename(chat: Session) {
    setRenaming({ id: chat.id, value: chat.title ?? '' });
    setTimeout(() => renameInputRef.current?.select(), 0);
  }

  function commitRename() {
    if (!renaming) return;
    const trimmed = renaming.value.trim();
    const original = chats.find(c => c.id === renaming.id)?.title ?? '';
    if (!trimmed || trimmed === original) { setRenaming(null); return; }
    renameMutation.mutate({ id: renaming.id, title: trimmed });
  }

  const newChatMutation = useMutation({
    mutationFn: async () => {
      const { id } = await createChat();
      await updateChatConfig(id, { pinned_space_id: project.space_id });
      return id;
    },
    onSuccess: (id: string) => navigate(`/c/${id}`),
  });

  return (
    <PageShell>
      <PageHeader
        title={project.name}
        breadcrumb="Chats"
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
        actions={
          <Button
            size="lg"
            className="h-9 gap-2 rounded-lg px-3 text-sm shadow-sm"
            onClick={() => newChatMutation.mutate()}
            disabled={newChatMutation.isPending}
          >
            <Plus size={16} />New chat
          </Button>
        }
      />
      <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
        <div className="mx-auto max-w-7xl">
          {isLoading ? (
            <PageLoading rows={3} />
          ) : chats.length === 0 ? (
            <div className="rounded-lg border border-border-soft bg-card px-4 py-8 text-center">
              <p className="text-sm font-medium text-foreground">No chats yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Start a conversation scoped to this project.</p>
            </div>
          ) : (
            <DataTable>
              <DataTableHeader className="grid-cols-[minmax(0,1fr)_6rem_1.75rem]">
                <span>Title</span>
                <span className="justify-self-end">Updated</span>
                <span />
              </DataTableHeader>
              <DataTableBody>
                {chats.map(chat => (
                  <DataTableRow key={chat.id} className="grid-cols-[minmax(0,1fr)_6rem_1.75rem]">
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
                          className="cursor-pointer truncate text-sm font-medium text-foreground underline-offset-2 hover:underline"
                          onClick={() => navigate(`/c/${chat.id}`)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/c/${chat.id}`); } }}
                        >
                          {chat.title ?? 'Untitled chat'}
                        </div>
                      )}
                    </div>
                    <span className="justify-self-end whitespace-nowrap text-[11px] text-faint-fg">{timeAgo(chat.updated_at)}</span>
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
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onSelect={() => startRename(chat)}>
                          <Pencil size={14} />Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(chat.id)}>
                          <Trash2 size={14} />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          )}
        </div>
      </PageBody>

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

function ProjectDocumentsView({ project }: { project: Project }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ['documents', project.space_id],
    queryFn: () => getDocuments(project.space_id),
    staleTime: 30_000,
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => updateDocumentById(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', project.space_id] });
      queryClient.invalidateQueries({ queryKey: ['documents-global'] });
      setRenaming(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocumentById(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', project.space_id] });
      queryClient.invalidateQueries({ queryKey: ['documents-global'] });
      setPendingDelete(null);
    },
    onError: () => setPendingDelete(null),
  });

  function commitRename() {
    if (!renaming) return;
    const trimmed = renaming.value.trim();
    const original = documents.find(d => d.id === renaming.id)?.title ?? '';
    if (!trimmed || trimmed === original) { setRenaming(null); return; }
    renameMutation.mutate({ id: renaming.id, title: trimmed });
  }

  return (
    <PageShell>
      <PageHeader
        title={project.name}
        breadcrumb="Documents"
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
      />
      <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
        <div className="mx-auto max-w-7xl">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : documents.length === 0 ? (
            <div className="rounded-lg border border-border-soft bg-card px-4 py-8 text-center">
              <p className="text-sm font-medium text-foreground">No documents yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Documents created in this project will appear here.</p>
            </div>
          ) : (
            <DataTable>
              <DataTableHeader className="grid-cols-[minmax(0,1fr)_6rem_1.75rem]">
                <span>Title</span>
                <span className="justify-self-end">Updated</span>
                <span />
              </DataTableHeader>
              <DataTableBody>
                {documents.map(doc => (
                  <DataTableRow key={doc.id} className="grid-cols-[minmax(0,1fr)_6rem_1.75rem]">
                    <div className="min-w-0">
                      {renaming?.id === doc.id ? (
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
                        <Link
                          to={`/documents/${doc.id}`}
                          className="block truncate text-sm font-medium text-foreground underline-offset-2 hover:underline"
                        >
                          {doc.title}
                        </Link>
                      )}
                    </div>
                    <span className="justify-self-end whitespace-nowrap text-[11px] text-faint-fg">{timeAgo(doc.updated_at)}</span>
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
                        <DropdownMenuItem onSelect={() => { setRenaming({ id: doc.id, value: doc.title }); setTimeout(() => renameInputRef.current?.select(), 0); }}>
                          <Pencil size={14} />Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(doc.id)}>
                          <Trash2 size={14} />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          )}
        </div>
      </PageBody>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete document?"
          description="This will permanently delete the document. This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </PageShell>
  );
}

function ProjectOverview({ project, navigate }: { project: Project; navigate: ReturnType<typeof useNavigate> }) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editBranch, setEditBranch] = useState(project.default_branch ?? '');
  const [editDescription, setEditDescription] = useState('');
  const [settingsEditing, setSettingsEditing] = useState(false);

  const { data: connections = [] } = useQuery<Connection[]>({ queryKey: ['connections'], queryFn: getConnections });
  const mcpConnections = connections.filter(c => c.type === 'mcp');

  const { data: spaces = [] } = useQuery<Space[]>({
    queryKey: ['spaces'],
    queryFn: getSpaces,
    staleTime: 60_000,
  });
  const space = spaces.find(s => s.id === project.space_id);

  const { data: allChats = [] } = useQuery<Session[]>({ queryKey: ['chats'], queryFn: () => getChats() });
  const recentChats = allChats.filter((c: Session) => c.pinned_space_id === project.space_id).slice(0, 4);

  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ['documents', project.space_id],
    queryFn: () => getDocuments(project.space_id),
    staleTime: 30_000,
  });
  const recentDocs = [...documents].sort((a, b) => b.updated_at - a.updated_at).slice(0, 4);

  const updateMutation = useMutation({
    mutationFn: async () => {
      await updateProject(project.id, {
        name: editName.trim() || project.name,
        default_branch: editBranch.trim() || null,
      });
      await updateSpace(project.space_id, { description: editDescription.trim() || null as unknown as string });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTopLevelProject(project.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['projects'] }); navigate('/projects'); },
  });

  const newChatMutation = useMutation({
    mutationFn: async () => {
      const { id } = await createChat();
      await updateChatConfig(id, { pinned_space_id: project.space_id });
      return id;
    },
    onSuccess: (id: string) => navigate(`/c/${id}`),
  });

  function toggleMcp(connectionId: string) {
    if (!space) return;
    const current = space.enabled_connection_ids ?? [];
    const updated = current.includes(connectionId) ? current.filter(id => id !== connectionId) : [...current, connectionId];
    updateSpace(project.space_id, { enabled_connection_ids: updated }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['spaces'] }),
    );
  }

  useEffect(() => {
    setEditName(project.name);
    setEditBranch(project.default_branch ?? '');
    setEditDescription(space?.description ?? '');
    setSettingsEditing(false);
  }, [project.id, project.name, project.default_branch, space?.description]);

  return (
    <PageShell>
      <PageHeader
        title={project.name}
        breadcrumb="Overview"
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
        actions={
          <Button
            size="lg"
            className="h-9 gap-2 rounded-lg px-3 text-sm shadow-sm"
            onClick={() => newChatMutation.mutate()}
            disabled={newChatMutation.isPending}
          >
            <Plus size={16} />New chat
          </Button>
        }
      />
      <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
        <div className="mx-auto grid w-full max-w-7xl gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
          <div className="min-w-0 space-y-5">
            <ProjectSummaryPanel project={project} />
            <RecentChatsCard
              chats={recentChats}
              projectId={project.id}
              onNew={() => newChatMutation.mutate()}
              onOpen={id => navigate(`/c/${id}`)}
            />
            <RecentDocsCard docs={recentDocs} />
          </div>

          <aside className="min-w-0 space-y-5 pt-1">
            <ProjectSettingsPanel
              project={project}
              spaceDescription={space?.description ?? null}
              editing={settingsEditing}
              editName={editName}
              editBranch={editBranch}
              editDescription={editDescription}
              saving={updateMutation.isPending}
              onNameChange={setEditName}
              onBranchChange={setEditBranch}
              onDescriptionChange={setEditDescription}
              onEdit={() => {
                setEditName(project.name);
                setEditBranch(project.default_branch ?? '');
                setEditDescription(space?.description ?? '');
                setSettingsEditing(true);
              }}
              onCancel={() => {
                setEditName(project.name);
                setEditBranch(project.default_branch ?? '');
                setEditDescription(space?.description ?? '');
                setSettingsEditing(false);
              }}
              onSave={() => updateMutation.mutate(undefined, { onSuccess: () => setSettingsEditing(false) })}
            />

            {mcpConnections.length > 0 && (
              <McpToolsPanel
                connections={mcpConnections}
                enabledIds={space?.enabled_connection_ids ?? []}
                onToggle={toggleMcp}
              />
            )}

            <DangerPanel onDelete={() => setConfirmDelete(true)} />
          </aside>
        </div>
      </PageBody>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${project.name}?`}
          description="This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </PageShell>
  );
}

function RecentChatsCard({
  chats,
  projectId,
  onNew,
  onOpen,
}: {
  chats: Session[];
  projectId: string;
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="rounded-lg border border-border-soft bg-card">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border-soft px-4 py-2.5">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <h2 className="text-sm font-medium text-foreground">Recent chats</h2>
        </div>
        <div className="flex items-center gap-2">
          {chats.length > 0 && (
            <Link
              to={`/projects/${projectId}/chats`}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              View all
            </Link>
          )}
          <button
            type="button"
            onClick={onNew}
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="New chat"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
      {chats.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">No chats yet</p>
          <button
            type="button"
            onClick={onNew}
            className="mt-2 text-xs text-primary hover:underline"
          >
            Start a conversation
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-border-soft">
          {chats.map(chat => (
            <li key={chat.id}>
              <button
                type="button"
                onClick={() => onOpen(chat.id)}
                className="flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {chat.title ?? 'Untitled chat'}
                </span>
                <span className="shrink-0 text-[11px] text-faint-fg">{timeAgo(chat.updated_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentDocsCard({ docs }: { docs: Document[] }) {
  if (docs.length === 0) return null;
  return (
    <section className="rounded-lg border border-border-soft bg-card">
      <div className="flex min-h-12 items-center gap-2 border-b border-border-soft px-4 py-2.5">
        <FileText size={14} className="shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <h2 className="text-sm font-medium text-foreground">Recent documents</h2>
      </div>
      <ul className="divide-y divide-border-soft">
        {docs.map(doc => (
          <li key={doc.id}>
            <Link
              to={`/documents/${doc.id}`}
              className="flex min-w-0 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{doc.title}</span>
              {doc.type && (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground capitalize">
                  {doc.type}
                </span>
              )}
              <span className="shrink-0 text-[11px] text-faint-fg">{timeAgo(doc.updated_at)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProjectSummaryPanel({ project }: { project: Project }) {
  return (
    <section className="rounded-lg border border-border-soft bg-card">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border-soft px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">Repository</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {project.repo_path || 'No repository linked'}
          </p>
        </div>
        <Link
          to={`/projects/${project.id}/files`}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="View files"
          aria-label="View files"
        >
          <ArrowRight size={14} />
        </Link>
      </div>
      <div className="grid divide-y divide-border-soft sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <ProjectFact label="Branch" value={project.default_branch ?? 'Not set'} icon={<GitBranch size={11} />} />
        <ProjectFact label="Origin" value={project.origin === 'linked' ? 'Linked repo' : 'Created'} />
        <ProjectFact label="Created" value={formatProjectDate(project.created_at)} />
      </div>
    </section>
  );
}

function ProjectFact({ label, value, icon, mono }: { label: string; value: string; icon?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-2.5">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={`mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-sm text-foreground ${mono ? 'font-mono text-xs' : 'font-medium'}`}>
        {icon && <span className="shrink-0 text-faint-fg">{icon}</span>}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

function formatProjectDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ProjectSettingsPanel({
  project,
  spaceDescription,
  editing,
  editName,
  editBranch,
  editDescription,
  saving,
  onNameChange,
  onBranchChange,
  onDescriptionChange,
  onEdit,
  onCancel,
  onSave,
}: {
  project: Project;
  spaceDescription: string | null;
  editing: boolean;
  editName: string;
  editBranch: string;
  editDescription: string;
  saving: boolean;
  onNameChange: (value: string) => void;
  onBranchChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <RightRailSection
      title={(
        <span className="flex items-center justify-between gap-3">
          <span>Project settings</span>
          {!editing && (
            <button
              type="button"
              onClick={onEdit}
              className="text-xs font-medium text-primary hover:underline"
            >
              Edit
            </button>
          )}
        </span>
      )}
    >
      {editing ? (
        <div className="space-y-2.5">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Name</span>
            <Input value={editName} onChange={e => onNameChange(e.target.value)} className="h-8 text-xs" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Default branch</span>
            <Input value={editBranch} onChange={e => onBranchChange(e.target.value)} placeholder="main" className="h-8 text-xs" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Description</span>
            <textarea
              value={editDescription}
              onChange={e => onDescriptionChange(e.target.value)}
              placeholder="What is this project about? The agent uses this as context."
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" className="h-7 text-xs" disabled={saving || !editName.trim()} onClick={onSave}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={saving} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <ReadOnlyRow label="Name" value={project.name} />
          <ReadOnlyRow label="Default branch" value={project.default_branch ?? 'Not set'} />
          {spaceDescription && (
            <div className="pt-1">
              <span className="block text-[11px] text-muted-foreground">Description</span>
              <p className="mt-0.5 text-xs leading-relaxed text-foreground">{spaceDescription}</p>
            </div>
          )}
        </div>
      )}
    </RightRailSection>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-h-8 grid-cols-[7rem_minmax(0,1fr)] items-center gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function McpToolsPanel({
  connections,
  enabledIds,
  onToggle,
}: {
  connections: Connection[];
  enabledIds: string[];
  onToggle: (connectionId: string) => void;
}) {
  return (
    <RightRailSection
      title={(
        <span className="flex items-center gap-2">
          MCP tools
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground">{connections.length}</span>
        </span>
      )}
    >
      <div className="space-y-1">
        {connections.map(conn => {
          const enabled = enabledIds.includes(conn.id);
          return (
            <div key={conn.id} className="grid min-h-8 grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-3">
              <span className="truncate text-sm font-medium text-foreground">{conn.name}</span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => onToggle(conn.id)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${enabled ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          );
        })}
      </div>
    </RightRailSection>
  );
}

function DangerPanel({ onDelete }: { onDelete: () => void }) {
  return (
    <RightRailSection title={<span className="text-destructive">Danger zone</span>}>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">Permanently deletes this project and its documents.</p>
      <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={onDelete}>Delete project</Button>
    </RightRailSection>
  );
}

function RightRailSection({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-border-soft pt-4 first:border-t-0 first:pt-0">
      <h2 className="mb-2.5 text-sm font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}
