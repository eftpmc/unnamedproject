import { useState } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FileText, GitBranch, GitGraph, Video } from 'lucide-react';
import { getProjects, getProjectCampaigns, getProjectCapabilities, createChat, updateChatConfig, deleteProject, updateProject, getChats, getProjectFile } from '../lib/api.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyPanel, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import { cn } from '@/lib/utils';
import FileBrowser from '../components/FileBrowser.js';
import ArtifactsTab from '../components/ArtifactsTab.js';
import { timeAgo } from '../lib/utils.js';
import type { Project, Campaign, Session } from '../types.js';

type Tab = string;

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'files', label: 'Files' },
  { id: 'settings', label: 'Settings' },
];

function StatusPill({ status }: { status: Campaign['status'] }) {
  const styles: Record<Campaign['status'], string> = {
    running: 'bg-primary/10 text-on-accent-soft',
    done: 'bg-success/10 text-success',
    error: 'bg-destructive/10 text-destructive',
    cancelled: 'bg-muted text-muted-foreground',
  };
  const labels: Record<Campaign['status'], string> = {
    running: 'Running', done: 'Done', error: 'Error', cancelled: 'Cancelled',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', styles[status])}>
      {status === 'running' && <span className="mr-1 size-1.5 animate-pulse rounded-full bg-primary" />}
      {labels[status]}
    </span>
  );
}

function tabFromPath(pathname: string): Tab {
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (last === 'campaigns' || last === 'files' || last === 'settings') return last;
  // Any other trailing segment after the project id is treated as an extra tab id.
  if (segments.length >= 3 && segments[0] === 'projects') return last;
  return 'overview';
}

function tabHref(projectId: string, tab: Tab) {
  if (tab === 'overview') return `/projects/${projectId}`;
  return `/projects/${projectId}/${tab}`;
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const tab = tabFromPath(location.pathname);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
    staleTime: 30_000,
  });
  const project = projects.find(p => p.id === projectId) ?? null;

  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ['project-campaigns', projectId],
    queryFn: () => getProjectCampaigns(projectId!),
    enabled: !!projectId,
    staleTime: 20_000,
  });

  const { data: allChats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });
  const pinnedChats = allChats.filter(c => c.pinned_project_id === projectId);

  const startChatMutation = useMutation({
    mutationFn: async () => {
      const { id } = await createChat();
      await updateChatConfig(id, { pinned_project_id: projectId ?? null });
      return id;
    },
    onSuccess: (id) => navigate(`/c/${id}`),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(projectId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate('/projects');
    },
  });

  const { data: caps } = useQuery({
    queryKey: ['project-capabilities', projectId],
    queryFn: () => getProjectCapabilities(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const { data: workspaceMd } = useQuery({
    queryKey: ['project-workspace-md', projectId],
    queryFn: () => getProjectFile(projectId!, 'workspace.md'),
    enabled: !!projectId,
    staleTime: 60_000,
    retry: false,
  });

  if (!project) {
    return (
      <PageShell>
        <PageLoading rows={3} />
      </PageShell>
    );
  }

  const runningCampaigns = campaigns.filter(c => c.status === 'running');
  const runningCount = runningCampaigns.length;
  const activeCampaign = runningCampaigns[0] ?? null;
  const recentCampaigns = campaigns.filter(c => c.id !== activeCampaign?.id);
  const artifactsCount = 0;

  return (
    <PageShell>
      <PageHeader
        title={project.name}
        description={project.description || undefined}
        className="border-b-0 pb-0"
        actions={
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => startChatMutation.mutate()}
            disabled={startChatMutation.isPending}
          >
            Start chat
          </Button>
        }
      />
      {/* Tab strip */}
      <div className="flex shrink-0 gap-0 overflow-x-auto border-b border-border-soft px-5">
        {TABS.map(t => (
          <Link
            key={t.id}
            to={tabHref(projectId!, t.id)}
            className={cn(
              'border-b-2 px-1 pb-3 pt-3 text-sm font-medium whitespace-nowrap transition-colors',
              'mx-3 first:ml-0',
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-fg-soft',
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <div className="max-w-4xl p-4 sm:p-6 flex flex-col gap-5">
            {/* 1. Active campaign hero */}
            {activeCampaign && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Active Campaign</div>
                <Link
                  to={`/projects/${projectId}/campaigns/${activeCampaign.id}`}
                  className="block rounded-xl border border-border/50 bg-background/55 p-4 transition-colors hover:bg-background/85"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{activeCampaign.title}</span>
                    <StatusPill status={activeCampaign.status} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Started {timeAgo(activeCampaign.created_at)}
                  </div>
                </Link>
              </div>
            )}

            {/* 2. Stats row */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Campaigns', value: campaigns.length, onClick: () => navigate(tabHref(projectId!, 'campaigns')) },
                { label: 'Artifacts', value: artifactsCount, onClick: undefined },
                { label: 'Running now', value: runningCount, onClick: undefined },
              ].map(s => (
                <button
                  type="button"
                  key={s.label}
                  onClick={s.onClick}
                  disabled={!s.onClick}
                  className="rounded-xl border border-border-soft bg-card p-4 text-left transition-[transform,box-shadow,border-color] hover:enabled:-translate-y-px hover:enabled:border-border hover:enabled:shadow-md disabled:cursor-default"
                >
                  <div className="text-2xl font-semibold tracking-tight text-foreground">{s.value}</div>
                  <div className="mt-1.5 text-xs text-muted-foreground">{s.label}</div>
                </button>
              ))}
            </div>

            {/* 3. Recent campaigns */}
            {recentCampaigns.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-muted-foreground">Recent Campaigns</div>
                  <Link
                    to={tabHref(project.id, 'campaigns')}
                    className="text-xs text-indigo-500 hover:text-indigo-400 transition-colors"
                  >
                    View all →
                  </Link>
                </div>
                <div className="overflow-hidden rounded-xl border border-border/50 bg-background/60 divide-y divide-border/50">
                  {recentCampaigns.slice(0, 3).map(c => (
                    <Link
                      key={c.id}
                      to={`/projects/${projectId}/campaigns/${c.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <span className="text-sm font-medium truncate">{c.title}</span>
                      <div className="flex items-center gap-3 shrink-0 ml-3">
                        <StatusPill status={c.status} />
                        <span className="text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* 4. Recent chats */}
            {pinnedChats.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-muted-foreground">Recent Chats</div>
                </div>
                <div className="overflow-hidden rounded-xl border border-border/50 bg-background/60 divide-y divide-border/50">
                  {pinnedChats.slice(0, 2).map(chat => (
                    <button
                      key={chat.id}
                      aria-label={`Open chat ${chat.title ?? 'Untitled chat'}`}
                      onClick={() => navigate(`/c/${chat.id}`)}
                      className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                    >
                      <span className="text-sm font-medium truncate">{chat.title ?? 'Untitled chat'}</span>
                      <span className="text-xs text-muted-foreground shrink-0 ml-3">{timeAgo(chat.updated_at)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 5. workspace.md */}
            {workspaceMd?.content && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">workspace.md</div>
                <div className="rounded-xl border border-border/50 bg-background/55 px-4 py-3">
                  <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-sans leading-relaxed">{workspaceMd.content}</pre>
                </div>
              </div>
            )}

            {/* 6. Capabilities */}
            {(caps?.has_graph || caps?.has_media || caps?.has_research || project.repo_path) && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Capabilities</div>
                <div className="flex flex-wrap gap-2">
                  {caps?.has_graph && (
                    <span className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/55 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <GitGraph size={11} className="shrink-0" />
                      graph indexed
                    </span>
                  )}
                  {caps?.has_media && (
                    <span className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/55 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <Video size={11} className="shrink-0" />
                      videos rendered
                    </span>
                  )}
                  {caps?.has_research && (
                    <span className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/55 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <FileText size={11} className="shrink-0" />
                      research saved
                    </span>
                  )}
                  {project.repo_path && (
                    <span className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/55 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <GitBranch size={11} className="shrink-0" />
                      {project.repo_path.split('/').pop()}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 7. Empty state */}
            {campaigns.length === 0 && pinnedChats.length === 0 && (
              <EmptyPanel
                title="Nothing here yet"
                description="Start a chat and ask the agent to get to work. Campaigns and activity will appear here."
                action={
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => startChatMutation.mutate()}
                    disabled={startChatMutation.isPending}
                  >
                    Start chat
                  </Button>
                }
              />
            )}
          </div>
        )}

        {tab === 'campaigns' && (
          <div className="max-w-4xl p-4 sm:p-6">
            {campaigns.length === 0 ? (
              <EmptyPanel
                title="No campaigns yet"
                description="Start a chat and ask the agent to plan or execute work — it will create a campaign to track progress."
                action={
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => startChatMutation.mutate()}
                    disabled={startChatMutation.isPending}
                  >
                    Start chat
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-col gap-2">
                {campaigns.map(c => (
                  <button
                    type="button"
                    key={c.id}
                    className="flex w-full items-center gap-3 rounded-xl border border-border-soft bg-card p-4 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-md"
                    onClick={() => navigate(`/projects/${projectId}/campaigns/${c.id}`)}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{c.title}</span>
                        <StatusPill status={c.status} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint-fg">
                        <span>updated {timeAgo(c.created_at)}</span>
                      </div>
                    </div>
                    <ChevronRight size={15} className="shrink-0 text-faint-fg" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'chats' && (
          <div className="max-w-4xl p-4 sm:p-6">
            {pinnedChats.length === 0 ? (
              <EmptyPanel
                title="No chats yet"
                description="Chats started from this project are pinned here for easy access."
                action={
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => startChatMutation.mutate()}
                    disabled={startChatMutation.isPending}
                  >
                    Start chat
                  </Button>
                }
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border/50 bg-background/60 divide-y divide-border/50">
                {pinnedChats.map((chat) => (
                  <button
                    key={chat.id}
                    aria-label={`Open chat ${chat.title ?? 'Untitled chat'}`}
                    onClick={() => navigate(`/c/${chat.id}`)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                  >
                    <span className="text-sm font-medium truncate">
                      {chat.title ?? 'Untitled chat'}
                    </span>
                    <span className="shrink-0 ml-3 text-xs text-muted-foreground">
                      {timeAgo(chat.updated_at)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'files' && (
          <div className="p-4 sm:p-6">
            <FileBrowser projectId={projectId!} />
          </div>
        )}

        {tab === 'artifacts' && (
          <div className="p-4 sm:p-6">
            <ArtifactsTab project={project} />
          </div>
        )}

        {tab === 'settings' && (
          <div className="p-4 sm:p-6 max-w-lg">
            <ProjectSettingsForm project={project} onDelete={() => deleteMutation.mutate()} />
          </div>
        )}
      </div>
    </PageShell>
  );
}

function ProjectSettingsForm({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState(project.description ?? '');

  const updateMutation = useMutation({
    mutationFn: () => updateProject(project.id, { description: description.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const handleDelete = onDelete;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
          <input
            value={project.name}
            disabled
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-faint-fg focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-faint-fg focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {project.repo_path && (
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Repo path</label>
            <input
              value={project.repo_path}
              disabled
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-mono text-foreground placeholder:text-faint-fg focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}
        <Button
          size="sm"
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending}
          className="w-fit"
        >
          Save changes
        </Button>
      </div>
      <div className="border-t border-border/40 pt-5">
        <div className="text-xs font-medium text-muted-foreground mb-3">Danger zone</div>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
          <div>
            <div className="text-sm font-medium text-foreground">Delete project</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Permanently remove this project and all its campaigns.</div>
          </div>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-white transition-[filter] hover:brightness-105"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
