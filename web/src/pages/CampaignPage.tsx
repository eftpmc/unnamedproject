import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, FileEdit, GitBranch, GitPullRequest, X } from 'lucide-react';
import { getCampaign, cancelCampaign } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '@/lib/utils';
import { timeAgo } from '../lib/utils.js';
import { getToken } from '../lib/auth.js';
import { ContentColumn, PageBody, PageHeader, PageLoading, PageShell, Surface } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';
import type { Campaign, CampaignTask, WSCampaignTaskUpdated, WSCampaignUpdated } from '../types.js';

const STATUS_DOT: Record<CampaignTask['status'], string> = {
  waiting: 'bg-muted-foreground/30',
  running: 'bg-blue-500 animate-pulse',
  done: 'bg-green-500',
  error: 'bg-destructive',
};

const STATUS_BORDER: Record<CampaignTask['status'], string> = {
  waiting: 'border-border/50',
  running: 'border-blue-500/30',
  done: 'border-green-500/30',
  error: 'border-destructive/30',
};

const STATUS_BG: Record<CampaignTask['status'], string> = {
  waiting: 'bg-background/60',
  running: 'bg-blue-500/5',
  done: 'bg-green-500/5',
  error: 'bg-destructive/5',
};

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

const CAMPAIGN_STATUS_COLORS = {
  running: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  done: 'bg-green-500/10 text-green-700 dark:text-green-300',
  error: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

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
            <span className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium',
              CAMPAIGN_STATUS_COLORS[effectiveCampaignStatus],
            )}>
              {effectiveCampaignStatus}
            </span>
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
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{doneCount} / {tasks.length}</span>
        </div>
      </div>

      <PageBody>
        <ContentColumn className="max-w-2xl">
        <div className="flex flex-col gap-3">
          {tasks.map(task => {
            const status = taskStatuses[task.id] ?? task.status;
            return (
              <TaskRow key={task.id} task={task} status={status} />
            );
          })}
        </div>
        </ContentColumn>
      </PageBody>
    </PageShell>
  );
}

function TaskRow({ task, status }: { task: CampaignTask; status: CampaignTask['status'] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Surface className={cn('transition-colors', STATUS_BORDER[status], STATUS_BG[status])}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[status])} />
          <span className={cn('text-sm font-medium truncate', status === 'waiting' && 'text-muted-foreground')}>
            {task.title}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-3">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {(() => { const Icon = AGENT_ICON[task.agent]; return <Icon className="size-3" />; })()}
            {AGENT_LABEL[task.agent]}
          </span>
          <span className={cn(
            'text-xs font-medium',
            status === 'done' && 'text-green-600',
            status === 'running' && 'text-blue-600',
            status === 'error' && 'text-destructive',
            status === 'waiting' && 'text-muted-foreground/50',
          )}>
            {status}
          </span>
          {(status === 'done' || status === 'running' || status === 'error') && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? 'hide output' : 'view output'}
            </button>
          )}
        </div>
      </div>
      {expanded && task.execution_id && (
        <ExecutionOutput executionId={task.execution_id} />
      )}
    </Surface>
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
