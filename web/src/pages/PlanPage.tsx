import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, Bot, Check, ChevronRight, Cpu, FileEdit, FileText, GitBranch, GitPullRequest, MessageSquare, Plus, RotateCcw, Sparkles, Terminal, X, Zap } from 'lucide-react';
import { getPlan, cancelPlan, resumePlan, createChat, updateChatConfig, getChats, getProjectArtifacts, getSessionWorktree, getProjects } from '../lib/api.js';
import ArtifactPreviewCard from '../components/ArtifactPreviewCard.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '@/lib/utils';
import { timeAgo } from '../lib/utils.js';
import { getToken } from '../lib/auth.js';
import { PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import type { Plan, PlanStep, Project, ProjectArtifact, Session, WSPlanStepUpdated, WSPlanUpdated } from '../types.js';

const AGENT_LABEL: Record<PlanStep['agent'], string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  mcp: 'MCP',
  file_write: 'Write File',
  git: 'Git',
  github: 'GitHub',
  eval: 'Eval',
  subagent: 'Sub-agent',
};

const AGENT_ICON: Record<PlanStep['agent'], typeof Bot> = {
  claude_code: Bot,
  codex: Bot,
  mcp: Bot,
  file_write: FileEdit,
  git: GitBranch,
  github: GitPullRequest,
  eval: Terminal,
  subagent: Cpu,
};

function buildWaves(steps: PlanStep[]): PlanStep[][] {
  const waves: PlanStep[][] = [];
  const assigned = new Set<string>();
  let remaining = steps.filter(s => !assigned.has(s.id));
  while (remaining.length > 0) {
    const wave = remaining.filter(s => {
      const deps: string[] = s.depends_on ? JSON.parse(s.depends_on) : [];
      return deps.every(depId => assigned.has(depId));
    });
    if (wave.length === 0) { waves.push(remaining); break; }
    wave.forEach(s => assigned.add(s.id));
    waves.push(wave);
    remaining = steps.filter(s => !assigned.has(s.id));
  }
  return waves;
}

function StatusDot({ status }: { status: PlanStep['status'] }) {
  const cls: Record<PlanStep['status'], string> = {
    waiting: 'bg-faint-fg',
    running: 'bg-primary animate-pulse',
    done:    'bg-success',
    error:   'bg-destructive',
  };
  return <span className={cn('size-1.5 shrink-0 rounded-full', cls[status])} />;
}

export default function PlanPage() {
  const { projectId, planId } = useParams<{ projectId: string; planId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['plan', planId],
    queryFn: () => getPlan(planId!),
    enabled: !!planId,
    refetchInterval: (query) => {
      return query.state.data?.plan.status === 'running' ? 10_000 : false;
    },
  });

  const queryClient = useQueryClient();
  const [stepStatuses, setStepStatuses] = useState<Record<string, PlanStep['status']>>({});
  const [planStatus, setPlanStatus] = useState<Plan['status'] | null>(null);
  useEffect(() => {
    if (!data) return;
    setStepStatuses(prev => {
      const updates: Record<string, PlanStep['status']> = {};
      for (const s of data.steps) {
        // Seed steps not yet known; always accept terminal statuses to recover WS gaps
        if (!(s.id in prev) || s.status === 'done' || s.status === 'error') {
          updates[s.id] = s.status;
        }
      }
      return Object.keys(updates).length ? { ...prev, ...updates } : prev;
    });
    setPlanStatus(prev => {
      const terminal = data.plan.status === 'done' || data.plan.status === 'error' || data.plan.status === 'cancelled';
      return (prev === null || terminal) ? data.plan.status : prev;
    });
  }, [data]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === 'plan_step_updated') {
        const e = event as WSPlanStepUpdated;
        setStepStatuses(prev => ({ ...prev, [e.stepId]: e.status }));
      }
      if (event.type === 'plan_updated') {
        const e = event as WSPlanUpdated;
        if (e.planId === planId) setPlanStatus(e.status);
      }
    });
  }, [planId]);

  const cancelMutation = useMutation({
    mutationFn: () => cancelPlan(planId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plan', planId] }),
  });

  const resumeMutation = useMutation({
    mutationFn: () => resumePlan(planId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plan', planId] }),
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
    staleTime: 30_000,
  });
  const project = projects.find(p => p.id === projectId) ?? null;

  const { data: chats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });

  const { data: artifactData } = useQuery<{ artifacts: ProjectArtifact[] }>({
    queryKey: ['project-artifacts', projectId],
    queryFn: () => getProjectArtifacts(projectId!),
    enabled: !!projectId,
    staleTime: 20_000,
  });

  const originatingSessionId = data?.plan.session_id ?? null;
  const { data: worktree } = useQuery({
    queryKey: ['worktree', originatingSessionId],
    queryFn: () => getSessionWorktree(originatingSessionId!),
    enabled: !!originatingSessionId,
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

  if (isLoading) {
    return (
      <PageShell>
        <PageLoading rows={4} />
      </PageShell>
    );
  }

  if (isError || !data) {
    return (
      <PageShell>
        <PageHeader title="Plan not found" />
      </PageShell>
    );
  }

  const { plan, steps } = data;
  const effectivePlanStatus = planStatus ?? plan.status;
  const effectiveStatuses = steps.map(s => stepStatuses[s.id] ?? s.status);
  const doneCount = effectiveStatuses.filter(s => s === 'done').length;
  const progressPct = steps.length > 0 ? (doneCount / steps.length) * 100 : 0;
  const hasDeps = steps.some(s => s.depends_on && s.depends_on !== '[]');
  const waves = hasDeps ? buildWaves(steps) : null;
  const relatedChat = plan.session_id ? chats.find(chat => chat.id === plan.session_id) : null;
  const relatedArtifacts = (artifactData?.artifacts ?? []).filter(a => a.source_plan_id === plan.id);
  const branchName = worktree?.branch ?? null;
  const stepEvents = steps
    .filter(step => (stepStatuses[step.id] ?? step.status) !== 'waiting')
    .slice(0, 4);

  return (
    <PageShell>
      <PageHeader
        breadcrumb={(
          <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link to="/projects" className="transition-colors hover:text-foreground">
              Projects
            </Link>
            <ChevronRight size={12} className="text-faint-fg" />
            <Link to={`/projects/${projectId}`} className="transition-colors hover:text-foreground">
              {project?.name ?? 'Project'}
            </Link>
            <ChevronRight size={12} className="text-faint-fg" />
            <Link to={`/projects/${projectId}/plans`} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Plans
            </Link>
            <ChevronRight size={12} className="text-faint-fg" />
            <span className="text-foreground">{plan.title}</span>
          </nav>
        )}
        title={plan.title}
        description={(
          <>
            Started {timeAgo(plan.created_at)}
            {plan.completed_at && ` · completed ${timeAgo(plan.completed_at)}`}
          </>
        )}
        actions={(
          <div className="flex items-center gap-2">
            <StatusPill status={effectivePlanStatus} />
            <Button
              size="sm"
              onClick={() => startChatMutation.mutate()}
              disabled={startChatMutation.isPending}
              className="h-8 gap-1.5 text-xs"
            >
              <Plus size={14} />
              New chat
            </Button>
            {effectivePlanStatus === 'error' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => resumeMutation.mutate()}
                disabled={resumeMutation.isPending}
                className="h-7 gap-1 text-xs text-muted-foreground"
              >
                <RotateCcw size={12} />
                Resume
              </Button>
            )}
            {effectivePlanStatus === 'running' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="h-7 gap-1 text-xs text-muted-foreground"
              >
                <X size={12} />
                Cancel
              </Button>
            )}
          </div>
        )}
      />

      <PageBody>
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1fr)_16.5rem] lg:items-start">
          <div className="flex min-w-0 flex-col gap-8">
            <section>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="text-sm font-semibold text-foreground">Progress</h2>
                <span className="ml-auto text-xs text-muted-foreground">{doneCount} of {steps.length} done</span>
              </div>
              <div className="mb-4 h-2 overflow-hidden rounded-full border border-border-soft bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {waves ? (
                <div className="flex flex-col gap-3">
                  {waves.map((wave, wi) => (
                    <div key={wi}>
                      {wave.length > 1 && (
                        <div className="mb-2 flex items-center gap-2">
                          <Zap size={11} className="shrink-0 text-primary" />
                          <span className="text-[11px] font-medium text-primary">
                            {wave.length} steps in parallel
                          </span>
                          <div className="flex-1 border-t border-dashed border-border-soft" />
                        </div>
                      )}
                      <div className={wave.length > 1 ? 'grid grid-cols-1 gap-1 sm:grid-cols-2' : 'flex flex-col'}>
                        {wave.map(step => {
                          const status = stepStatuses[step.id] ?? step.status;
                          return (
                            <div key={step.id} className={wave.length > 1 ? 'rounded-lg border border-border-soft bg-muted/30 px-3 py-1' : ''}>
                              <StepRow step={step} status={status} />
                            </div>
                          );
                        })}
                      </div>
                      {wi < waves.length - 1 && (
                        <div className="mt-3 flex justify-center">
                          <ArrowDown size={14} className="text-border" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col">
                  {steps.map(step => {
                    const status = stepStatuses[step.id] ?? step.status;
                    return <StepRow key={step.id} step={step} status={status} />;
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">Chats</h2>
                <span className="rounded-full border border-border-soft bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {relatedChat ? 1 : 0}
                </span>
              </div>
              {relatedChat ? (
                <button
                  type="button"
                  onClick={() => navigate(`/c/${relatedChat.id}`)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border-soft bg-card p-4 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    <MessageSquare size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{relatedChat.title ?? 'Untitled chat'}</span>
                    <span className="mt-0.5 block text-xs text-faint-fg">Updated {timeAgo(relatedChat.updated_at)}</span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-faint-fg" />
                </button>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  No originating chat is attached to this plan yet.
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">Artifacts</h2>
                <span className="rounded-full border border-border-soft bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {relatedArtifacts.length}
                </span>
              </div>
              {relatedArtifacts.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {relatedArtifacts.map(artifact => (
                    <ArtifactPreviewCard
                      key={artifact.id}
                      artifactId={artifact.id}
                      projectId={artifact.project_id}
                      title={artifact.title}
                      kind={artifact.kind}
                      mimeType={artifact.mime_type}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  Artifacts produced by this plan will appear here.
                </div>
              )}
            </section>
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-0">
            <div className="flex flex-col gap-3 rounded-lg border border-border-soft bg-card p-4">
              <InfoRow label="Status" value={<StatusPill status={effectivePlanStatus} />} />
              {branchName && (
                <InfoRow label="Branch" value={<code className="max-w-32 truncate font-mono text-[11px] text-fg-soft">{branchName}</code>} />
              )}
              <InfoRow label="Started" value={<span className="text-xs font-medium text-foreground">{timeAgo(plan.created_at)}</span>} />
              {plan.completed_at && (
                <InfoRow label="Completed" value={<span className="text-xs font-medium text-foreground">{timeAgo(plan.completed_at)}</span>} />
              )}
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-border-soft bg-card p-4">
              <div className="text-xs font-semibold text-muted-foreground">Recent activity</div>
              <div className="flex flex-col gap-4">
                {stepEvents.length > 0 ? stepEvents.map((step, index) => {
                  const status = stepStatuses[step.id] ?? step.status;
                  const Icon = AGENT_ICON[step.agent];
                  return (
                    <div key={step.id} className="relative flex gap-3">
                      {index < stepEvents.length - 1 && <span className="absolute left-3 top-7 h-[calc(100%+0.5rem)] w-px bg-border-soft" />}
                      <span className="z-10 grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                        <Icon size={12} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground">{AGENT_LABEL[step.agent]}</span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{step.title}</span>
                        <span className="mt-0.5 block text-[11px] text-faint-fg">{status === 'running' ? 'running · ' : ''}{timeAgo(step.created_at)}</span>
                      </span>
                    </div>
                  );
                }) : (
                  <div className="text-xs text-muted-foreground">No step activity yet.</div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </PageBody>
    </PageShell>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 shrink">{value}</span>
    </div>
  );
}

function StepRow({ step, status }: { step: PlanStep; status: PlanStep['status'] }) {
  const [expanded, setExpanded] = useState(false);
  const done = status === 'done';

  return (
    <div className="border-b border-border-soft py-2.5 last:border-b-0">
      <div
        className={cn(
          'flex items-center gap-3 text-sm',
          done ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        <span className={cn(
          'grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors',
          done ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
        )}>
          {done && <Check size={11} strokeWidth={2.5} />}
        </span>
        <span className={cn('min-w-0 flex-1', done && 'line-through decoration-faint-fg decoration-1')}>{step.title}</span>
        <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
          {(() => { const Icon = AGENT_ICON[step.agent]; return <Icon className="size-3" />; })()}
          {AGENT_LABEL[step.agent]}
        </span>
        <StatusDot status={status} />
        {(status === 'done' || status === 'running' || status === 'error') && step.execution_id && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? 'hide' : 'view'}
          </button>
        )}
      </div>
      {expanded && step.execution_id && (
        <ExecutionOutput executionId={step.execution_id} />
      )}
    </div>
  );
}

function ExecutionOutput({ executionId }: { executionId: string }) {
  const { data } = useQuery({
    queryKey: ['execution-output', executionId],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`/executions/${executionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json() as Promise<{ output_log: string; result: string | null }>;
    },
    staleTime: 5_000,
  });

  return (
    <div className="border-t border-border/30 px-4 py-3">
      <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto">
        {data?.output_log || data?.result || 'No output yet'}
      </pre>
    </div>
  );
}
