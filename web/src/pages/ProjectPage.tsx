import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, FileText, GitGraph, MessageSquare, Play, Sparkles, Trash2, Video, Workflow } from 'lucide-react';
import { getProjects, getProjectPlans, getProjectCapabilities, createChat, updateChatConfig, deleteProject, updateProject, getChats, getProjectFile, getProjectArtifacts, getPipelines, deletePipeline, runPipeline, getProjectWorkspace, updateProjectWorkspace } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyPanel, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import FileBrowser from '../components/FileBrowser.js';
import ArtifactsTab from '../components/ArtifactsTab.js';
import { timeAgo } from '../lib/utils.js';
import type { Project, Plan, Session, ProjectArtifact, Pipeline } from '../types.js';

type Tab = string;

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'plans', label: 'Plans' },
  { id: 'chats', label: 'Chats' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'files', label: 'Files' },
  { id: 'pipelines', label: 'Pipelines' },
  { id: 'settings', label: 'Settings' },
];

const KNOWN_TABS = new Set(TABS.map(t => t.id));

function tabFromPath(pathname: string): Tab {
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (KNOWN_TABS.has(last) && last !== 'overview') return last;
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

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
    staleTime: 30_000,
  });
  const project = projects.find(p => p.id === projectId) ?? null;
  usePageTitle(project?.name);

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['project-plans', projectId],
    queryFn: () => getProjectPlans(projectId!),
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

  const { data: pipelinesData, isLoading: pipelinesLoading } = useQuery({
    queryKey: ['pipelines'],
    queryFn: getPipelines,
    staleTime: 30_000,
    enabled: tab === 'pipelines',
  });

  const [runningPipeline, setRunningPipeline] = useState<Pipeline | null>(null);
  const [pendingDeletePipeline, setPendingDeletePipeline] = useState<string | null>(null);
  const [pendingDeleteProject, setPendingDeleteProject] = useState(false);

  const deletePipelineMutation = useMutation({
    mutationFn: deletePipeline,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      setPendingDeletePipeline(null);
    },
    onError: () => setPendingDeletePipeline(null),
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
    queryFn: () => getProjectFile(projectId!, 'workspace.md').catch(() => null),
    enabled: !!projectId,
    staleTime: 60_000,
    retry: false,
  });

  if (projectsLoading) {
    return (
      <PageShell>
        <PageLoading rows={3} />
      </PageShell>
    );
  }

  if (!project) {
    return (
      <PageShell>
        <PageHeader title="Project not found" />
      </PageShell>
    );
  }

  const runningPlans = plans.filter(p => p.status === 'running');
  const runningCount = runningPlans.length;
  const activePlan = runningPlans[0] ?? null;
  const recentActivityPlans = plans
    .filter(p => p.id !== activePlan?.id)
    .slice(0, Math.max(1, 4 - (activePlan ? 1 : 0)));
  const artifactsCount = artifactData?.artifacts.length ?? 0;

  const countsForPlan = (plan: Plan) => ({
    artifactCount: (artifactData?.artifacts ?? []).filter(a => a.source_plan_id === plan.id).length,
    chatCount: plan.session_id && allChats.some(ch => ch.id === plan.session_id) ? 1 : 0,
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
            <MessageSquare size={14} />
            New chat
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
      <div className={cn('flex-1', tab === 'artifacts' ? 'flex min-h-0 flex-col overflow-hidden' : 'overflow-y-auto')}>
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
                { label: 'Plans', value: plans.length, onClick: () => navigate(tabHref(projectId!, 'plans')) },
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

            {runningPlans.length > 0 && (
              <ProjectSection title="Active now">
                <div className="flex flex-col gap-2.5">
                  {runningPlans.map(p => (
                    <PlanRow key={p.id} plan={p} projectId={projectId!} {...countsForPlan(p)} />
                  ))}
                </div>
              </ProjectSection>
            )}

            <ProjectSection title="Recent activity">
              <div className="flex flex-col gap-2.5">
                {activePlan && (
                  <ActivityRow
                    icon={<Sparkles size={17} />}
                    title={activePlan.title}
                    subtitle={`Plan started ${timeAgo(activePlan.created_at)}`}
                    trailing={<StatusPill status={activePlan.status} />}
                    onClick={() => navigate(`/projects/${projectId}/plans/${activePlan.id}`)}
                  />
                )}
                {recentActivityPlans.map(plan => (
                  <ActivityRow
                    key={plan.id}
                    icon={<Sparkles size={17} />}
                    title={plan.title}
                    subtitle={`Plan · ${timeAgo(plan.created_at)}`}
                    trailing={<StatusPill status={plan.status} />}
                    onClick={() => navigate(`/projects/${projectId}/plans/${plan.id}`)}
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

            {plans.length === 0 && pinnedChats.length === 0 && (
              <EmptyPanel
                title="Nothing here yet"
                description="Start a chat and ask the agent to get to work. Plans and activity will appear here."
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

        {tab === 'plans' && (
          <div className="mx-auto max-w-5xl p-4 sm:p-6">
            {plans.length === 0 ? (
              <EmptyPanel
                title="No plans yet"
                description="Start a chat and ask the agent to plan or execute work — it will create a plan to track progress."
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
            ) : (() => {
              const active = plans.filter(p => p.status === 'running');
              const errored = plans.filter(p => p.status === 'error');
              const rest = plans.filter(p => p.status !== 'running' && p.status !== 'error');
              const groups: { label: string; items: Plan[] }[] = [];
              if (active.length) groups.push({ label: 'Running', items: active });
              if (errored.length) groups.push({ label: 'Needs attention', items: errored });
              if (rest.length) groups.push({ label: active.length || errored.length ? 'Completed' : 'All plans', items: rest });
              return (
                <div className="flex flex-col gap-6">
                  {groups.map(group => (
                    <div key={group.label}>
                      {groups.length > 1 && (
                        <div className="mb-2 text-[11px] font-semibold text-faint-fg">{group.label}</div>
                      )}
                      <div className="flex flex-col gap-2">
                        {group.items.map(p => (
                          <PlanRow key={p.id} plan={p} projectId={projectId!} {...countsForPlan(p)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
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
          <div className="flex h-full flex-col">
            <ArtifactsTab project={project} />
          </div>
        )}

        {tab === 'pipelines' && (
          <div className="mx-auto max-w-2xl p-4 sm:p-6">
            {pipelinesLoading ? (
              <PageLoading rows={3} />
            ) : (pipelinesData?.pipelines ?? []).length === 0 ? (
              <EmptyPanel
                title="No pipelines yet"
                description='Create a pipeline by asking the agent — e.g. "Create a pipeline that runs tests, fixes issues, then opens a PR."'
              />
            ) : (
              <div className="flex flex-col gap-2">
                {(pipelinesData?.pipelines ?? []).map((pipeline: Pipeline) => (
                  <PipelineRow
                    key={pipeline.id}
                    pipeline={pipeline}
                    onRun={() => setRunningPipeline(pipeline)}
                    onDelete={() => setPendingDeletePipeline(pipeline.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {pendingDeletePipeline && (
          <ConfirmDialog
            title="Delete pipeline?"
            description="This removes the pipeline template. Plans already created from it are not affected."
            confirmLabel="Delete"
            onConfirm={() => deletePipelineMutation.mutate(pendingDeletePipeline)}
            onCancel={() => setPendingDeletePipeline(null)}
          />
        )}

        {runningPipeline && (
          <RunPipelineDialog
            pipeline={runningPipeline}
            projectId={projectId!}
            onClose={() => setRunningPipeline(null)}
          />
        )}

        {tab === 'settings' && (
          <div className="mx-auto max-w-2xl p-4 sm:p-6">
            <ProjectSettingsForm project={project} onDelete={() => setPendingDeleteProject(true)} />
          </div>
        )}

        {pendingDeleteProject && (
          <ConfirmDialog
            title="Delete project?"
            description="This will permanently delete the project, all its plans, and associated data. This cannot be undone."
            confirmLabel="Delete"
            onConfirm={() => { setPendingDeleteProject(false); deleteMutation.mutate(); }}
            onCancel={() => setPendingDeleteProject(false)}
          />
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

function PlanRow({
  plan,
  projectId,
  chatCount = 0,
  artifactCount = 0,
}: {
  plan: Plan;
  projectId: string;
  chatCount?: number;
  artifactCount?: number;
}) {
  return (
    <Link
      to={`/projects/${projectId}/plans/${plan.id}`}
      className="flex w-full items-center gap-3 rounded-lg border border-border-soft bg-card p-4 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold tracking-[-0.01em] text-foreground">{plan.title}</span>
          <StatusPill status={plan.status} />
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
          <span>{plan.completed_at ? `completed ${timeAgo(plan.completed_at)}` : `started ${timeAgo(plan.created_at)}`}</span>
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
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [repoPath, setRepoPath] = useState(project.repo_path ?? '');
  const [workspaceContent, setWorkspaceContent] = useState<string | null>(null);
  const [workspaceSaved, setWorkspaceSaved] = useState(false);

  const { data: workspaceData, isLoading: workspaceLoading } = useQuery({
    queryKey: ['project-workspace', project.id],
    queryFn: () => getProjectWorkspace(project.id),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (workspaceData && workspaceContent === null) {
      setWorkspaceContent(workspaceData.content);
    }
  }, [workspaceData, workspaceContent]);

  const updateMutation = useMutation({
    mutationFn: () => updateProject(project.id, {
      name: name.trim() || project.name,
      description: description.trim(),
      repo_path: repoPath.trim() || null,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const workspaceMutation = useMutation({
    mutationFn: () => updateProjectWorkspace(project.id, workspaceContent ?? ''),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-workspace', project.id] });
      setWorkspaceSaved(true);
      setTimeout(() => setWorkspaceSaved(false), 2000);
    },
  });

  function handleDelete() {
    onDelete();
  }

  const fieldClass = 'w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-faint-fg focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold text-fg-soft">General</h2>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Project name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="What does this project contain?"
            className={`${fieldClass} resize-none`}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Repository path</label>
          <input
            value={repoPath}
            onChange={e => setRepoPath(e.target.value)}
            placeholder="/Users/you/code/my-app"
            className={`${fieldClass} font-mono`}
          />
          <p className="mt-1 text-[11px] text-faint-fg">Absolute path to a local git repo. Leave blank for a document-only project.</p>
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="h-8 gap-1.5 text-xs"
          >
            <Check size={13} strokeWidth={2.2} />
            {updateMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-fg-soft">workspace.md</h2>
          <p className="mt-0.5 text-[11px] text-faint-fg">The agent reads this file at the start of each session. Use it to record goals, decisions, and progress.</p>
        </div>
        {workspaceLoading ? (
          <div className="h-32 animate-pulse rounded-md border border-border bg-muted/30" />
        ) : (
          <textarea
            value={workspaceContent ?? ''}
            onChange={e => setWorkspaceContent(e.target.value)}
            rows={10}
            placeholder={`# ${project.name}\n\nCurrent goal: ...\n\nDecisions:\n- ...`}
            className={`${fieldClass} resize-y font-mono text-[13px] leading-relaxed`}
          />
        )}
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => workspaceMutation.mutate()}
            disabled={workspaceMutation.isPending || workspaceContent === null}
            className="h-8 gap-1.5 text-xs"
          >
            {workspaceSaved ? <Check size={13} strokeWidth={2.5} className="text-success" /> : <Check size={13} strokeWidth={2.2} />}
            {workspaceMutation.isPending ? 'Saving…' : workspaceSaved ? 'Saved' : 'Save workspace.md'}
          </Button>
        </div>
      </section>

      <section className="flex items-center justify-between gap-4 rounded-lg border border-destructive/25 bg-destructive/5 p-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">Delete project</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Permanently remove this project and all its plans.</div>
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

function RunPipelineDialog({
  pipeline,
  projectId,
  onClose,
}: {
  pipeline: Pipeline;
  projectId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();

  const runMutation = useMutation({
    mutationFn: () => runPipeline(pipeline.id, projectId),
    onSuccess: ({ plan_id, project_id }: { plan_id: string; project_id: string }) => {
      navigate(`/projects/${project_id}/plans/${plan_id}`);
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background shadow-lg">
        <div className="border-b border-border-soft px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Run pipeline</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{pipeline.title}</p>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-muted-foreground">This will start a new plan in the current project.</p>
          {runMutation.isError && (
            <p className="mt-2 text-xs text-destructive">Failed to start pipeline run.</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-soft px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={runMutation.isPending}
            onClick={() => runMutation.mutate()}
            className="gap-1.5"
          >
            <Play size={12} />
            {runMutation.isPending ? 'Starting…' : 'Run now'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PipelineRow({
  pipeline,
  onRun,
  onDelete,
}: {
  pipeline: Pipeline;
  onRun: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3.5 transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
        <Workflow size={15} className="text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{pipeline.title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {pipeline.description ?? `${pipeline.task_count ?? 0} steps`}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          onClick={onRun}
          className="gap-1.5 text-xs opacity-0 transition-opacity group-hover:opacity-100"
        >
          <Play size={11} />
          Run
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete pipeline"
          className={cn(
            'shrink-0 text-faint-fg opacity-0 transition-[opacity,color]',
            'hover:text-destructive group-hover:opacity-100',
          )}
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  );
}
