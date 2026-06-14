import { useState } from 'react';
import type { ReactNode } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, FileText, GitGraph, MessageSquare, Sparkles, Video } from 'lucide-react';
import { getProjects, getProjectCampaigns, getProjectCapabilities, createChat, updateChatConfig, deleteProject, updateProject, getChats, getProjectFile, getProjectArtifacts } from '../lib/api.js';
import { Button } from '@/components/ui/button';
import { EmptyPanel, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import FileBrowser from '../components/FileBrowser.js';
import ArtifactsTab from '../components/ArtifactsTab.js';
import { timeAgo } from '../lib/utils.js';
import type { Project, Campaign, Session, ProjectArtifact } from '../types.js';

type Tab = string;

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'files', label: 'Files' },
  { id: 'settings', label: 'Settings' },
];

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

  const { data: artifactData } = useQuery<{ artifacts: ProjectArtifact[] }>({
    queryKey: ['project-artifacts', projectId],
    queryFn: () => getProjectArtifacts(projectId!),
    enabled: !!projectId,
    staleTime: 20_000,
  });

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
  const recentActivityCampaigns = campaigns
    .filter(c => c.id !== activeCampaign?.id)
    .slice(0, Math.max(1, 4 - (activeCampaign ? 1 : 0)));
  const artifactsCount = artifactData?.artifacts.length ?? 0;

  const countsForCampaign = (campaign: Campaign) => ({
    artifactCount: (artifactData?.artifacts ?? []).filter(a => a.source_campaign_id === campaign.id).length,
    chatCount: campaign.session_id && allChats.some(ch => ch.id === campaign.session_id) ? 1 : 0,
  });

  return (
    <PageShell>
      <PageHeader
        title={project.name}
        description={project.description || undefined}
        className="border-b-0 pb-0"
        breadcrumb={
          <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link to="/projects" className="transition-colors hover:text-foreground">Projects</Link>
            <ChevronRight size={12} className="text-faint-fg" />
            <span className="text-foreground">{project.name}</span>
          </nav>
        }
        actions={
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => startChatMutation.mutate()}
            disabled={startChatMutation.isPending}
          >
            <Sparkles size={14} />
            New campaign
          </Button>
        }
      />
      {/* Tab strip */}
      <div className="flex shrink-0 gap-0 overflow-x-auto border-b border-border-soft px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
          <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-5 sm:px-6">
            {project.repo_path && (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border-soft bg-card p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    <GitGraph size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm font-semibold text-foreground">{project.repo_path}</div>
                    <div className="mt-0.5 text-xs text-faint-fg">Local repository</div>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                  <Check size={11} strokeWidth={2.4} />
                  Connected
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
              {[
                { label: 'Campaigns', value: campaigns.length, onClick: () => navigate(tabHref(projectId!, 'campaigns')) },
                { label: 'Artifacts', value: artifactsCount, onClick: () => navigate(tabHref(projectId!, 'artifacts')) },
                { label: 'Running now', value: runningCount, onClick: undefined },
              ].map(s => (
                <button
                  type="button"
                  key={s.label}
                  onClick={s.onClick}
                  disabled={!s.onClick}
                  className="rounded-lg border border-border-soft bg-card p-4 text-left transition-[transform,box-shadow,border-color] hover:enabled:-translate-y-px hover:enabled:border-border hover:enabled:shadow-sm disabled:cursor-default"
                >
                  <div className="text-[1.7rem] font-semibold leading-none tracking-tight text-foreground">{s.value}</div>
                  <div className="mt-2 text-[13px] text-muted-foreground">{s.label}</div>
                </button>
              ))}
            </div>

            {runningCampaigns.length > 0 && (
              <ProjectSection title="Active now">
                <div className="flex flex-col gap-2.5">
                  {runningCampaigns.map(c => (
                    <CampaignRow key={c.id} campaign={c} projectId={projectId!} {...countsForCampaign(c)} />
                  ))}
                </div>
              </ProjectSection>
            )}

            <ProjectSection title="Recent activity">
              <div className="flex flex-col gap-2.5">
                {activeCampaign && (
                  <ActivityRow
                    icon={<Sparkles size={17} />}
                    title={activeCampaign.title}
                    subtitle={`Campaign started ${timeAgo(activeCampaign.created_at)}`}
                    trailing={<StatusPill status={activeCampaign.status} />}
                    onClick={() => navigate(`/projects/${projectId}/campaigns/${activeCampaign.id}`)}
                  />
                )}
                {recentActivityCampaigns.map(campaign => (
                  <ActivityRow
                    key={campaign.id}
                    icon={<Sparkles size={17} />}
                    title={campaign.title}
                    subtitle="Campaign"
                    trailing={<span className="text-xs text-faint-fg">{timeAgo(campaign.created_at)}</span>}
                    onClick={() => navigate(`/projects/${projectId}/campaigns/${campaign.id}`)}
                  />
                ))}
                {pinnedChats.slice(0, 2).map(chat => (
                  <ActivityRow
                    key={chat.id}
                    icon={<MessageSquare size={17} />}
                    title={chat.title ?? 'Untitled chat'}
                    subtitle="Related chat"
                    trailing={<span className="text-xs text-faint-fg">{timeAgo(chat.updated_at)}</span>}
                    onClick={() => navigate(`/c/${chat.id}`)}
                  />
                ))}
                {caps?.has_graph && (
                  <ActivityRow
                    icon={<GitGraph size={17} />}
                    title="Project graph indexed"
                    subtitle={project.repo_path ? project.repo_path.split('/').pop() ?? 'Repository context' : 'Repository context'}
                    trailing={<span className="text-xs text-faint-fg">ready</span>}
                  />
                )}
                {caps?.has_media && (
                  <ActivityRow
                    icon={<Video size={17} />}
                    title="Video rendering available"
                    subtitle="Media capability"
                    trailing={<span className="text-xs text-faint-fg">ready</span>}
                  />
                )}
                {workspaceMd?.content && (
                  <ActivityRow
                    icon={<FileText size={17} />}
                    title="workspace.md loaded"
                    subtitle="Project instructions"
                    trailing={<span className="text-xs text-faint-fg">ready</span>}
                  />
                )}
              </div>
            </ProjectSection>

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
          <div className="mx-auto max-w-5xl p-4 sm:p-6">
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
                  <CampaignRow key={c.id} campaign={c} projectId={projectId!} {...countsForCampaign(c)} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'chats' && (
          <div className="mx-auto max-w-5xl p-4 sm:p-6">
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
              <div className="divide-y divide-border-soft overflow-hidden rounded-lg border border-border-soft bg-card">
                {pinnedChats.map((chat) => (
                  <button
                    type="button"
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
          <div className="mx-auto max-w-2xl p-4 sm:p-6">
            <ProjectSettingsForm project={project} onDelete={() => deleteMutation.mutate()} />
          </div>
        )}
      </div>
    </PageShell>
  );
}

function ProjectSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-[13px] font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function CampaignRow({
  campaign,
  projectId,
  chatCount = 0,
  artifactCount = 0,
}: {
  campaign: Campaign;
  projectId: string;
  chatCount?: number;
  artifactCount?: number;
}) {
  return (
    <Link
      to={`/projects/${projectId}/campaigns/${campaign.id}`}
      className="flex w-full items-center gap-3 rounded-lg border border-border-soft bg-card p-4 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold tracking-[-0.01em] text-foreground">{campaign.title}</span>
          <StatusPill status={campaign.status} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-faint-fg">
          {chatCount > 0 && (
            <>
              <span className="inline-flex items-center gap-1">
                <MessageSquare size={12} />
                {chatCount} chat{chatCount !== 1 ? 's' : ''}
              </span>
              <span className="text-border">·</span>
            </>
          )}
          <span className="inline-flex items-center gap-1">
            <Sparkles size={12} />
            {artifactCount} artifact{artifactCount !== 1 ? 's' : ''}
          </span>
          <span className="text-border">·</span>
          <span>updated {timeAgo(campaign.created_at)}</span>
        </div>
      </div>
      <ChevronRight size={16} className="shrink-0 text-faint-fg" />
    </Link>
  );
}

function ActivityRow({
  icon,
  title,
  subtitle,
  trailing,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  trailing: ReactNode;
  onClick?: () => void;
}) {
  const className = cn(
    'flex w-full items-center gap-3 rounded-lg border border-border-soft bg-card p-4 text-left',
    onClick && 'transition-colors hover:border-border',
  );
  const content = (
    <>
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <span className="shrink-0">{trailing}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={className}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

function ProjectSettingsForm({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState(project.description ?? '');

  const updateMutation = useMutation({
    mutationFn: () => updateProject(project.id, { description: description.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  function handleDelete() {
    if (!window.confirm('Delete this project and all its campaigns? This cannot be undone.')) return;
    onDelete();
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Project name</label>
          <input
            value={project.name}
            disabled
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-faint-fg focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-faint-fg focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold text-fg-soft">Connection</h2>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border-soft bg-card p-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Repository</div>
            <div className="mt-0.5 truncate font-mono text-xs text-faint-fg">{project.repo_path ?? 'No repository connected'}</div>
          </div>
          {project.repo_path ? <StatusPill status="done" /> : <span className="text-xs text-muted-foreground">Not connected</span>}
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border-soft bg-card p-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Default branch</div>
            <div className="mt-0.5 text-xs text-faint-fg">main</div>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs">Change</Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold text-fg-soft">Agent defaults</h2>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border-soft bg-card p-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Permission mode</div>
            <div className="mt-0.5 text-xs text-faint-fg">Ask before file writes and commits</div>
          </div>
          <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-lg border border-border/50 bg-muted/70 text-xs font-normal">
            Auto
            <ChevronDown size={12} />
          </Button>
        </div>
      </section>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending}
          className="h-8 gap-1.5 text-xs"
        >
          <Check size={14} strokeWidth={2.2} />
          Save changes
        </Button>
      </div>

      <section className="flex items-center justify-between gap-4 rounded-lg border border-destructive/25 bg-destructive/5 p-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">Delete project</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Permanently remove this project and all its campaigns.</div>
        </div>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={handleDelete}
          className="h-8 text-xs"
        >
          Delete
        </Button>
      </section>
    </div>
  );
}
