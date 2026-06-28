import { useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch, MessageSquare } from 'lucide-react';
import {
  getProject, updateProject, deleteTopLevelProject,
  getChats, createChat, updateChatConfig,
  getConnections, updateSpace, getSpaces,
} from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { timeAgo } from '../lib/utils.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ContentColumn, EmptyPanel, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import FileBrowser from '../components/FileBrowser.js';
import type { Connection, Project, Session } from '../types.js';

type SubRoute = 'overview' | 'files' | 'chats';

function subRoute(pathname: string, projectId: string): SubRoute {
  const suffix = pathname.slice(`/projects/${projectId}`.length).split('/').filter(Boolean)[0];
  if (suffix === 'files') return 'files';
  if (suffix === 'chats') return 'chats';
  return 'overview';
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const view = subRoute(location.pathname, projectId!);

  const { data: project, isLoading } = useQuery<Project>({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  });

  usePageTitle(project?.name);

  const { data: chats = [] } = useQuery<Session[]>({ queryKey: ['chats'], queryFn: () => getChats() });
  const projectChats = chats.filter(c => c.pinned_space_id === project?.space_id);

  const startChat = useMutation({
    mutationFn: async () => {
      const created = await createChat();
      await updateChatConfig(created.id, { pinned_space_id: project!.space_id });
      return created.id;
    },
    onSuccess: id => navigate(`/c/${id}`),
  });

  if (isLoading) return <PageShell><PageLoading rows={4} /></PageShell>;
  if (!project) return <PageShell><PageHeader title="Project not found" /></PageShell>;

  if (view === 'files') {
    return (
      <PageShell>
        <PageHeader title="Files" contentClassName="max-w-5xl" className="border-0 pb-0" />
        <PageBody className="p-4 sm:p-5">
          <div className="mx-auto max-w-5xl">
            <FileBrowser spaceId={project.space_id} projectId={project.id} projectName={project.name} />
          </div>
        </PageBody>
      </PageShell>
    );
  }

  if (view === 'chats') {
    return (
      <PageShell>
        <PageHeader
          title="Chats"
          contentClassName="max-w-5xl"
          className="border-0 pb-0"
          actions={
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => startChat.mutate()} disabled={startChat.isPending}>
              <MessageSquare size={14} />New chat
            </Button>
          }
        />
        <PageBody>
          <ContentColumn className="max-w-5xl">
            {projectChats.length === 0 ? (
              <EmptyPanel
                title="No chats yet"
                description="Start a chat pinned to this project."
                action={<Button size="sm" onClick={() => startChat.mutate()}>Start chat</Button>}
              />
            ) : (
              <div className="flex flex-col gap-2">
                {projectChats.sort((a, b) => b.updated_at - a.updated_at).map(chat => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => navigate(`/c/${chat.id}`)}
                    className="flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3.5 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm"
                  >
                    <MessageSquare size={15} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{chat.title ?? 'Untitled chat'}</span>
                    <span className="shrink-0 text-xs text-faint-fg">{timeAgo(chat.updated_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </ContentColumn>
        </PageBody>
      </PageShell>
    );
  }

  // Overview (default)
  return <ProjectOverview project={project} chats={projectChats} onNewChat={() => startChat.mutate()} />;
}

function ProjectOverview({ project, chats, onNewChat }: { project: Project; chats: Session[]; onNewChat: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editBranch, setEditBranch] = useState(project.default_branch ?? '');

  const { data: connections = [] } = useQuery<Connection[]>({ queryKey: ['connections'], queryFn: getConnections });
  const mcpConnections = connections.filter(c => c.type === 'mcp');

  // Load space to read enabled_connection_ids
  const { data: spaces = [] } = useQuery({
    queryKey: ['spaces'],
    queryFn: getSpaces,
    staleTime: 60_000,
  });
  const space = (spaces as { id: string; enabled_connection_ids: string[] }[]).find(s => s.id === project.space_id);

  const updateMutation = useMutation({
    mutationFn: () => updateProject(project.id, {
      name: editName.trim() || project.name,
      default_branch: editBranch.trim() || null,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', project.id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTopLevelProject(project.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['projects'] }); navigate('/projects'); },
  });

  function toggleMcp(connectionId: string) {
    if (!space) return;
    const current = space.enabled_connection_ids ?? [];
    const updated = current.includes(connectionId) ? current.filter(id => id !== connectionId) : [...current, connectionId];
    updateSpace(project.space_id, { enabled_connection_ids: updated }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['spaces'] }),
    );
  }

  const recentChats = [...chats].sort((a, b) => b.updated_at - a.updated_at).slice(0, 5);

  return (
    <PageShell>
      <PageHeader title="Overview" contentClassName="max-w-5xl" className="border-0 pb-0"
        actions={
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={onNewChat}>
            <MessageSquare size={14} />New chat
          </Button>
        }
      />
      <PageBody>
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-6 lg:flex-row lg:items-start">

          {/* Main column */}
          <div className="min-w-0 flex-1 flex flex-col gap-6">
            {/* Repo info */}
            {project.repo_path && (
              <div className="flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3">
                <GitBranch size={14} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{project.repo_path}</span>
                {project.default_branch && (
                  <span className="rounded-md bg-muted px-2 py-1 font-mono text-[11px]">{project.default_branch}</span>
                )}
              </div>
            )}

            {/* Recent chats */}
            {recentChats.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Recent chats</span>
                  <button type="button" onClick={() => navigate(`/projects/${project.id}/chats`)} className="text-[11px] text-faint-fg hover:text-muted-foreground">View all →</button>
                </div>
                {recentChats.map(chat => (
                  <button key={chat.id} type="button" onClick={() => navigate(`/c/${chat.id}`)}
                    className="flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm"
                  >
                    <MessageSquare size={14} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{chat.title ?? 'Untitled chat'}</span>
                    <span className="shrink-0 text-xs text-faint-fg">{timeAgo(chat.updated_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right panel */}
          <div className="flex w-full flex-col gap-4 lg:w-72 lg:shrink-0">
            {/* Settings */}
            <div className="rounded-xl border border-border-soft bg-card p-4">
              <h3 className="mb-3 text-xs font-semibold text-muted-foreground">Project</h3>
              <div className="flex flex-col gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Name</label>
                  <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Default branch</label>
                  <Input value={editBranch} onChange={e => setEditBranch(e.target.value)} placeholder="main" className="h-8 text-xs" />
                </div>
                <Button size="sm" className="h-7 text-xs" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate()}>
                  {updateMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>

            {/* MCP tools */}
            {mcpConnections.length > 0 && (
              <div className="rounded-xl border border-border-soft bg-card p-4">
                <h3 className="mb-3 text-xs font-semibold text-muted-foreground">MCP tools</h3>
                <div className="flex flex-col gap-2">
                  {mcpConnections.map(conn => {
                    const enabled = (space?.enabled_connection_ids ?? []).includes(conn.id);
                    return (
                      <div key={conn.id} className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{conn.name}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          onClick={() => toggleMcp(conn.id)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${enabled ? 'bg-primary' : 'bg-muted'}`}
                        >
                          <span className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Danger zone */}
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4">
              <h3 className="mb-1 text-xs font-semibold text-destructive">Danger zone</h3>
              <p className="mb-3 text-[11px] text-muted-foreground">Permanently deletes this project and its documents.</p>
              <Button variant="destructive" size="sm" className="h-7 text-xs w-full" onClick={() => setConfirmDelete(true)}>
                Delete project
              </Button>
            </div>
          </div>
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
