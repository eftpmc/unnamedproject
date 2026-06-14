import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, ChevronRight, FileEdit, FileText, GitBranch, GitPullRequest, MessageSquare, Plus, Sparkles, X } from 'lucide-react';
import { getCampaign, cancelCampaign, createChat, updateChatConfig, getChats, getProjectArtifacts, getSessionWorktree } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '@/lib/utils';
import { timeAgo } from '../lib/utils.js';
import { getToken } from '../lib/auth.js';
import { PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import type { Campaign, CampaignTask, ProjectArtifact, Session, WSCampaignTaskUpdated, WSCampaignUpdated } from '../types.js';

const AGENT_LABEL: Record<CampaignTask['agent'], string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  mcp: 'MCP',
  file_write: 'Write File',
  git: 'Git',
  github: 'GitHub',
};

// file_write/git/github steps run synchronously inline; claude_code/codex/mcp delegate to a long-running agent.
const AGENT_ICON: Record<CampaignTask['agent'], typeof Bot> = {
  claude_code: Bot,
  codex: Bot,
  mcp: Bot,
  file_write: FileEdit,
  git: GitBranch,
  github: GitPullRequest,
};

function StatusDot({ status }: { status: CampaignTask['status'] }) {
  const cls: Record<CampaignTask['status'], string> = {
    waiting: 'bg-faint-fg',
    running: 'bg-primary animate-pulse',
    done:    'bg-success',
    error:   'bg-destructive',
  };
  return <span className={cn('size-1.5 shrink-0 rounded-full', cls[status])} />;
}

export default function CampaignPage() {
  const { projectId, campaignId } = useParams<{ projectId: string; campaignId: string }>();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => getCampaign(campaignId!),
    enabled: !!campaignId,
    refetchInterval: (query) => {
      return query.state.data?.campaign.status === 'running' ? 10_000 : false;
    },
  });

  const queryClient = useQueryClient();
  const [taskStatuses, setTaskStatuses] = useState<Record<string, CampaignTask['status']>>({});
  const [campaignStatus, setCampaignStatus] = useState<Campaign['status'] | null>(null);

  useEffect(() => {
    if (data) {
      const initial: Record<string, CampaignTask['status']> = {};
      data.tasks.forEach(t => { initial[t.id] = t.status; });
      setTaskStatuses(initial);
      setCampaignStatus(data.campaign.status);
    }
  }, [data]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === 'campaign_task_updated') {
        const e = event as WSCampaignTaskUpdated;
        setTaskStatuses(prev => ({ ...prev, [e.taskId]: e.status }));
      }
      if (event.type === 'campaign_updated') {
        const e = event as WSCampaignUpdated;
        if (e.campaignId === campaignId) setCampaignStatus(e.status);
      }
    });
  }, [campaignId]);

  const cancelMutation = useMutation({
    mutationFn: () => cancelCampaign(campaignId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] }),
  });

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

  const originatingSessionId = data?.campaign.session_id ?? null;
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

  if (isLoading || !data) {
    return (
      <PageShell>
        <PageLoading rows={4} />
      </PageShell>
    );
  }

  const { campaign, tasks } = data;
  const effectiveCampaignStatus = campaignStatus ?? campaign.status;
  const effectiveStatuses = tasks.map(t => taskStatuses[t.id] ?? t.status);
  const doneCount = effectiveStatuses.filter(s => s === 'done').length;
  const progressPct = tasks.length > 0 ? (doneCount / tasks.length) * 100 : 0;
  const relatedChat = campaign.session_id ? chats.find(chat => chat.id === campaign.session_id) : null;
  const relatedArtifacts = (artifactData?.artifacts ?? []).filter(a => a.source_campaign_id === campaign.id);
  const branchName = worktree?.branch ?? null;
  const taskEvents = tasks
    .filter(task => (taskStatuses[task.id] ?? task.status) !== 'waiting')
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
              Project
            </Link>
            <ChevronRight size={12} className="text-faint-fg" />
            <Link to={`/projects/${projectId}/campaigns`} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Campaigns
            </Link>
            <ChevronRight size={12} className="text-faint-fg" />
            <span className="text-foreground">{campaign.title}</span>
          </nav>
        )}
        title={campaign.title}
        description={(
          <>
            Started {timeAgo(campaign.created_at)}
            {campaign.completed_at && ` · completed ${timeAgo(campaign.completed_at)}`}
          </>
        )}
        actions={(
          <div className="flex items-center gap-2">
            <StatusPill status={effectiveCampaignStatus} />
            <Button
              size="sm"
              onClick={() => startChatMutation.mutate()}
              disabled={startChatMutation.isPending}
              className="h-8 gap-1.5 text-xs"
            >
              <Plus size={14} />
              New chat
            </Button>
            {effectiveCampaignStatus === 'running' && (
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
                <span className="ml-auto text-xs text-muted-foreground">{doneCount} of {tasks.length} done</span>
              </div>
              <div className="mb-4 h-2 overflow-hidden rounded-full border border-border-soft bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex flex-col">
                {tasks.map(task => {
                  const status = taskStatuses[task.id] ?? task.status;
                  return <TaskRow key={task.id} task={task} status={status} />;
                })}
              </div>
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
                  No originating chat is attached to this campaign yet.
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
                    <div key={artifact.id} className="flex flex-col gap-3 rounded-lg border border-border-soft bg-card p-4">
                      <div className="grid aspect-[16/10] place-items-center rounded-md border border-border-soft bg-muted/35 bg-[repeating-linear-gradient(45deg,color-mix(in_oklch,var(--muted)_90%,transparent),color-mix(in_oklch,var(--muted)_90%,transparent)_8px,transparent_8px,transparent_16px)]">
                        <span className="rounded-md border border-border-soft bg-background/75 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                          {artifact.mime_type}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">{artifact.title}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{artifact.kind}</div>
                        </div>
                        <StatusPill status={artifact.status} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  Artifacts produced by this campaign will appear here.
                </div>
              )}
            </section>
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-0">
            <div className="flex flex-col gap-3 rounded-lg border border-border-soft bg-card p-4">
              <InfoRow label="Status" value={<StatusPill status={effectiveCampaignStatus} />} />
              {branchName && (
                <InfoRow label="Branch" value={<code className="max-w-32 truncate font-mono text-[11px] text-fg-soft">{branchName}</code>} />
              )}
              <InfoRow label="Started" value={<span className="text-xs font-medium text-foreground">{timeAgo(campaign.created_at)}</span>} />
              {campaign.completed_at && (
                <InfoRow label="Completed" value={<span className="text-xs font-medium text-foreground">{timeAgo(campaign.completed_at)}</span>} />
              )}
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-border-soft bg-card p-4">
              <div className="text-xs font-semibold text-muted-foreground">Recent activity</div>
              <div className="flex flex-col gap-4">
                {taskEvents.length > 0 ? taskEvents.map((task, index) => {
                  const status = taskStatuses[task.id] ?? task.status;
                  const Icon = AGENT_ICON[task.agent];
                  return (
                    <div key={task.id} className="relative flex gap-3">
                      {index < taskEvents.length - 1 && <span className="absolute left-3 top-7 h-[calc(100%+0.5rem)] w-px bg-border-soft" />}
                      <span className="z-10 grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                        <Icon size={12} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground">{AGENT_LABEL[task.agent]}</span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{task.title}</span>
                        <span className="mt-0.5 block text-[11px] text-faint-fg">{status === 'running' ? 'running · ' : ''}{timeAgo(task.created_at)}</span>
                      </span>
                    </div>
                  );
                }) : (
                  <div className="text-xs text-muted-foreground">No task activity yet.</div>
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

function TaskRow({ task, status }: { task: CampaignTask; status: CampaignTask['status'] }) {
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
        <span className={cn('min-w-0 flex-1', done && 'line-through decoration-faint-fg decoration-1')}>{task.title}</span>
        <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
          {(() => { const Icon = AGENT_ICON[task.agent]; return <Icon className="size-3" />; })()}
          {AGENT_LABEL[task.agent]}
        </span>
        <StatusDot status={status} />
        {(status === 'done' || status === 'running' || status === 'error') && task.execution_id && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? 'hide' : 'view'}
          </button>
        )}
      </div>
      {expanded && task.execution_id && (
        <ExecutionOutput executionId={task.execution_id} />
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
