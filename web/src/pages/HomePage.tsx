import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FileText, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import { ModuleCard, ModuleEmptyRow, ModuleIconButton, ModuleIconLink, ModuleRow, ModuleRowList } from '@/components/ui/module-card';
import { deleteChat, deleteTopLevelProject, getAllDocuments, getChats, getProjects, updateChatConfig, updateProject, createGlobalDocument } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Document, Project, Session } from '../types.js';

export default function HomePage() {
  usePageTitle('Home');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingProjectDelete, setPendingProjectDelete] = useState<Project | null>(null);
  const [pendingChatDelete, setPendingChatDelete] = useState<Session | null>(null);

  // New document dialog
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocProjectId, setNewDocProjectId] = useState('');

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => getProjects(),
  });
  const { data: chats = [], isLoading: chatsLoading } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: () => getChats(),
  });
  const { data: documents = [], isLoading: docsLoading } = useQuery<Document[]>({
    queryKey: ['documents-global'],
    queryFn: () => getAllDocuments(),
  });

  const recentChats = chats.slice(0, 5);
  const recentDocs = [...documents].sort((a, b) => b.updated_at - a.updated_at).slice(0, 5);

  const deleteProjectMutation = useMutation({
    mutationFn: (projectId: string) => deleteTopLevelProject(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setPendingProjectDelete(null);
    },
    onError: () => setPendingProjectDelete(null),
  });

  const deleteChatMutation = useMutation({
    mutationFn: (chatId: string) => deleteChat(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setPendingChatDelete(null);
    },
    onError: () => setPendingChatDelete(null),
  });

  const createDocMutation = useMutation({
    mutationFn: ({ title, spaceId }: { title: string; spaceId: string }) =>
      createGlobalDocument({ title, space_id: spaceId }),
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: ['documents-global'] });
      setDocDialogOpen(false);
      navigate(`/documents/${doc.id}`);
    },
  });

  function openDocDialog() {
    setNewDocTitle('');
    setNewDocProjectId(projects[0]?.id ?? '');
    setDocDialogOpen(true);
  }

  function submitDoc() {
    const title = newDocTitle.trim();
    const project = projects.find(p => p.id === newDocProjectId);
    if (!title || !project) return;
    createDocMutation.mutate({ title, spaceId: project.space_id! });
  }

  return (
    <PageShell>
      <PageHeader
        title="Home"
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
        actions={(
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="lg" className="h-9 gap-2 rounded-lg px-3 text-sm shadow-sm">
                <Plus size={16} />
                Add
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => navigate('/c')}>
                <Plus size={14} />
                New chat
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/projects/new')}>
                <Plus size={14} />
                Add project
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={openDocDialog}
                disabled={projects.length === 0}
              >
                <FileText size={14} />
                New document
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      {isLoading || chatsLoading || docsLoading ? (
        <PageLoading rows={3} />
      ) : (
        <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
          <div className="mx-auto grid w-full max-w-7xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ProjectsCard projects={projects} onAddProject={() => navigate('/projects/new')} onDeleteProject={setPendingProjectDelete} />
            <RecentChatsCard chats={recentChats} totalCount={chats.length} onNewChat={() => navigate('/c')} onDeleteChat={setPendingChatDelete} />
            <RecentDocumentsCard docs={recentDocs} totalCount={documents.length} onNewDocument={openDocDialog} hasProjects={projects.length > 0} />
          </div>
        </PageBody>
      )}

      {pendingProjectDelete && (
        <ConfirmDialog
          title={`Delete ${pendingProjectDelete.name}?`}
          description="This will permanently delete the project and its documents."
          confirmLabel="Delete"
          onConfirm={() => deleteProjectMutation.mutate(pendingProjectDelete.id)}
          onCancel={() => setPendingProjectDelete(null)}
        />
      )}

      {pendingChatDelete && (
        <ConfirmDialog
          title="Delete chat?"
          description="This will permanently delete the chat and all its messages."
          confirmLabel="Delete"
          onConfirm={() => deleteChatMutation.mutate(pendingChatDelete.id)}
          onCancel={() => setPendingChatDelete(null)}
        />
      )}

      <Dialog open={docDialogOpen} onOpenChange={setDocDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Title</span>
              <Input
                autoFocus
                value={newDocTitle}
                onChange={e => setNewDocTitle(e.target.value)}
                placeholder="Untitled document"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitDoc(); } }}
              />
            </label>
            {projects.length > 1 && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Project</span>
                <select
                  value={newDocProjectId}
                  onChange={e => setNewDocProjectId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDocDialogOpen(false)} disabled={createDocMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={submitDoc}
              disabled={!newDocTitle.trim() || !newDocProjectId || createDocMutation.isPending}
            >
              {createDocMutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function ProjectsCard({ projects, onAddProject, onDeleteProject }: { projects: Project[]; onAddProject: () => void; onDeleteProject: (project: Project) => void }) {
  return (
    <ModuleCard
      title="Projects"
      count={projects.length}
      actions={(
        <>
          <ModuleIconButton title="Add project" ariaLabel="Add project" onClick={onAddProject} bordered>
            <Plus size={13} />
          </ModuleIconButton>
          <ModuleIconLink to="/projects" title="View all projects" ariaLabel="View all projects">
            <ArrowRight size={13} />
          </ModuleIconLink>
        </>
      )}
    >
        {projects.length === 0 ? (
          <ModuleEmptyRow label="No projects yet" action="Add project" to="/projects/new" />
        ) : (
          <ModuleRowList>
            {projects.map((project, index) => (
              <ProjectRow key={project.id} project={project} divided={index > 0} onDeleteProject={onDeleteProject} />
            ))}
          </ModuleRowList>
        )}
    </ModuleCard>
  );
}

function ProjectRow({ project, divided, onDeleteProject }: { project: Project; divided: boolean; onDeleteProject: (project: Project) => void }) {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      const t = setTimeout(() => renameInputRef.current?.select(), 0);
      return () => clearTimeout(t);
    }
  }, [renaming]);

  const renameMutation = useMutation({
    mutationFn: (name: string) => updateProject(project.id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setRenaming(false);
    },
  });

  function startRename() {
    setRenameValue(project.name);
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === project.name) { setRenaming(false); return; }
    renameMutation.mutate(trimmed);
  }

  return (
    <ModuleRow divided={divided} className="grid-cols-[minmax(0,1fr)_1.75rem]">
        {renaming ? (
          <input
            ref={renameInputRef}
            className="min-w-0 flex-1 rounded border border-ring bg-background px-1 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring/50"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
            }}
            onBlur={commitRename}
          />
        ) : (
          <Link
            to={`/projects/${project.id}`}
            className="min-w-0 flex-1 truncate text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            {project.name}
          </Link>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Project options"
              aria-label={`Options for ${project.name}`}
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <MoreHorizontal size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={startRename}>
              <Pencil size={14} />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDeleteProject(project)}>
              <Trash2 size={14} />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
    </ModuleRow>
  );
}

function RecentChatsCard({ chats, totalCount, onNewChat, onDeleteChat }: { chats: Session[]; totalCount: number; onNewChat: () => void; onDeleteChat: (chat: Session) => void }) {
  return (
    <ModuleCard
      title="Recent chats"
      count={totalCount}
      actions={(
        <>
          <ModuleIconButton title="New chat" ariaLabel="New chat" onClick={onNewChat} bordered>
            <Plus size={13} />
          </ModuleIconButton>
          <ModuleIconLink to="/chats" title="View all chats" ariaLabel="View all chats">
            <ArrowRight size={13} />
          </ModuleIconLink>
        </>
      )}
    >
        {chats.length === 0 ? (
          <ModuleEmptyRow label="No chats yet" action="New chat" to="/c" />
        ) : (
          <ModuleRowList>
            {chats.map((chat, index) => (
              <ChatRow key={chat.id} chat={chat} divided={index > 0} onDeleteChat={onDeleteChat} />
            ))}
          </ModuleRowList>
        )}
    </ModuleCard>
  );
}

function ChatRow({ chat, divided, onDeleteChat }: { chat: Session; divided: boolean; onDeleteChat: (chat: Session) => void }) {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      const t = setTimeout(() => renameInputRef.current?.select(), 0);
      return () => clearTimeout(t);
    }
  }, [renaming]);

  const renameMutation = useMutation({
    mutationFn: (title: string) => updateChatConfig(chat.id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setRenaming(false);
    },
  });

  function startRename() {
    setRenameValue(chat.title ?? '');
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === chat.title) { setRenaming(false); return; }
    renameMutation.mutate(trimmed);
  }

  return (
    <ModuleRow divided={divided} className="grid-cols-[minmax(0,1fr)_1.75rem] sm:grid-cols-[minmax(0,1fr)_4.5rem_1.75rem]">
        {renaming ? (
          <input
            ref={renameInputRef}
            className="min-w-0 flex-1 rounded border border-ring bg-background px-1 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring/50"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
            }}
            onBlur={commitRename}
          />
        ) : (
          <Link
            to={`/c/${chat.id}`}
            className="min-w-0 flex-1 truncate text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            {chat.title ?? 'Untitled chat'}
          </Link>
        )}
        <span className="hidden justify-self-end whitespace-nowrap text-[11px] text-faint-fg sm:block">{timeAgo(chat.updated_at)}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Chat options"
              aria-label={`Options for ${chat.title ?? 'Untitled chat'}`}
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <MoreHorizontal size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={startRename}>
              <Pencil size={14} />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDeleteChat(chat)}>
              <Trash2 size={14} />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
    </ModuleRow>
  );
}

function RecentDocumentsCard({ docs, totalCount, onNewDocument, hasProjects }: {
  docs: Document[];
  totalCount: number;
  onNewDocument: () => void;
  hasProjects: boolean;
}) {
  return (
    <ModuleCard
      title="Documents"
      count={totalCount}
      actions={(
        <>
          <ModuleIconButton
            title={hasProjects ? 'New document' : 'Create a project first'}
            ariaLabel="New document"
            onClick={hasProjects ? onNewDocument : () => undefined}
            bordered
          >
            <Plus size={13} />
          </ModuleIconButton>
          <ModuleIconLink to="/documents" title="View all documents" ariaLabel="View all documents">
            <ArrowRight size={13} />
          </ModuleIconLink>
        </>
      )}
    >
      {docs.length === 0 ? (
        <ModuleEmptyRow label="No documents yet" action="View documents" to="/documents" />
      ) : (
        <ModuleRowList>
          {docs.map((doc, index) => (
            <DocumentRow key={doc.id} doc={doc} divided={index > 0} />
          ))}
        </ModuleRowList>
      )}
    </ModuleCard>
  );
}

function DocumentRow({ doc, divided }: { doc: Document; divided: boolean }) {
  return (
    <ModuleRow divided={divided} className="grid-cols-[minmax(0,1fr)_4rem]">
      <Link
        to={`/documents/${doc.id}`}
        className="min-w-0 flex-1 truncate text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        {doc.title}
      </Link>
      <span className="justify-self-end whitespace-nowrap text-[11px] text-faint-fg">{timeAgo(doc.updated_at)}</span>
    </ModuleRow>
  );
}
