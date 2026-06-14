import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, Check, FileEdit, GitBranch, GitPullRequest, X } from 'lucide-react';
import { getCampaign, cancelCampaign } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '@/lib/utils';
import { timeAgo } from '../lib/utils.js';
import { getToken } from '../lib/auth.js';
import { ContentColumn, PageBody, PageHeader, PageLoading, PageShell, Surface } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';
import type { Campaign, CampaignTask, WSCampaignTaskUpdated, WSCampaignUpdated } from '../types.js';

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

function StatusPill({ status }: { status: Campaign['status'] }) {
  const styles: Record<Campaign['status'], string> = {
    running: 'bg-primary/10 text-on-accent-soft',
    done:    'bg-success/10 text-success',
    error:   'bg-destructive/10 text-destructive',
    cancelled: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium', styles[status])}>
      {status === 'running' && <span className="size-1.5 animate-pulse rounded-full bg-primary" />}
      {{ running: 'Running', done: 'Done', error: 'Error', cancelled: 'Cancelled' }[status]}
    </span>
  );
}

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

  return (
    <PageShell>
      <PageHeader
        breadcrumb={(
          <div className="flex items-center gap-2">
            <Link to={`/projects/${projectId}`} className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft size={13} />
            </Link>
            <Link to={`/projects/${projectId}`} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Project
            </Link>
            <span className="text-xs text-muted-foreground/40">/</span>
            <Link to={`/projects/${projectId}/campaigns`} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Campaigns
            </Link>
          </div>
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
      <div className="px-4 py-2.5 sm:px-6 border-b border-border/40">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-border/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{doneCount} / {tasks.length}</span>
        </div>
      </div>

      <PageBody>
        <ContentColumn className="max-w-2xl">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_17rem] lg:items-start">
            {/* Left column — main content */}
            <div className="flex flex-col gap-6">
              <div className="flex flex-col">
                {tasks.map(task => {
                  const status = taskStatuses[task.id] ?? task.status;
                  return (
                    <TaskRow key={task.id} task={task} status={status} />
                  );
                })}
              </div>
            </div>
            {/* Right aside — sticky on large screens */}
            <aside className="flex flex-col gap-4 lg:sticky lg:top-0">
              <div className="rounded-xl border border-border-soft bg-card p-4 flex flex-col gap-3">
                {[
                  { label: 'Status', value: <StatusPill status={effectiveCampaignStatus} /> },
                  { label: 'Started', value: <span className="text-sm font-medium">{timeAgo(campaign.created_at)}</span> },
                  ...(campaign.completed_at ? [{ label: 'Completed', value: <span className="text-sm font-medium">{timeAgo(campaign.completed_at)}</span> }] : []),
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{row.label}</span>
                    {row.value}
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </ContentColumn>
      </PageBody>
    </PageShell>
  );
}

function TaskRow({ task, status }: { task: CampaignTask; status: CampaignTask['status'] }) {
  const [expanded, setExpanded] = useState(false);
  const done = status === 'done';

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-border-soft py-2.5 text-sm last:border-b-0',
        done ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      <span className={cn(
        'grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors',
        done ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
      )}>
        {done && <Check size={11} strokeWidth={2.5} />}
      </span>
      <span className={cn('flex-1', done && 'line-through decoration-faint-fg decoration-1')}>{task.title}</span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
        {(() => { const Icon = AGENT_ICON[task.agent]; return <Icon className="size-3" />; })()}
        {AGENT_LABEL[task.agent]}
      </span>
      <StatusDot status={status} />
      {(status === 'done' || status === 'running' || status === 'error') && task.execution_id && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          {expanded ? 'hide' : 'view'}
        </button>
      )}
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
