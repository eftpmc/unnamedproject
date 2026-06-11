import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { getCampaign } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '@/lib/utils';
import { timeAgo } from '../lib/utils.js';
import { getToken } from '../lib/auth.js';
import type { CampaignTask, WSCampaignTaskUpdated } from '../types.js';

const STATUS_DOT: Record<CampaignTask['status'], string> = {
  waiting: 'bg-muted-foreground/30',
  running: 'bg-blue-500 animate-pulse',
  done: 'bg-green-500',
  error: 'bg-destructive',
};

const STATUS_BORDER: Record<CampaignTask['status'], string> = {
  waiting: 'border-border/50',
  running: 'border-blue-200',
  done: 'border-green-200',
  error: 'border-red-200',
};

const STATUS_BG: Record<CampaignTask['status'], string> = {
  waiting: 'bg-background/60',
  running: 'bg-blue-50/60',
  done: 'bg-green-50/40',
  error: 'bg-red-50/40',
};

const AGENT_LABEL: Record<CampaignTask['agent'], string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  mcp: 'MCP',
};

const CAMPAIGN_STATUS_COLORS = {
  running: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
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

  const [taskStatuses, setTaskStatuses] = useState<Record<string, CampaignTask['status']>>({});

  useEffect(() => {
    if (data) {
      const initial: Record<string, CampaignTask['status']> = {};
      data.tasks.forEach(t => { initial[t.id] = t.status; });
      setTaskStatuses(initial);
    }
  }, [data]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === 'campaign_task_updated') {
        const e = event as WSCampaignTaskUpdated;
        setTaskStatuses(prev => ({ ...prev, [e.taskId]: e.status }));
      }
    });
  }, []);

  if (isLoading || !data) return null;

  const { campaign, tasks } = data;
  const effectiveStatuses = tasks.map(t => taskStatuses[t.id] ?? t.status);
  const doneCount = effectiveStatuses.filter(s => s === 'done').length;
  const progressPct = tasks.length > 0 ? (doneCount / tasks.length) * 100 : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border/40 px-6 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Link to={`/projects/${projectId}`} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={15} />
          </Link>
          <Link to={`/projects/${projectId}`} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Project
          </Link>
          <span className="text-xs text-muted-foreground/40">/</span>
          <span className="text-xs text-muted-foreground">Campaigns</span>
          <span className="text-xs text-muted-foreground/40">/</span>
          <span className="text-xs text-foreground font-medium truncate max-w-xs">{campaign.title}</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold">{campaign.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Started {timeAgo(campaign.created_at)}
              {campaign.completed_at && ` · completed ${timeAgo(campaign.completed_at)}`}
            </p>
          </div>
          <span className={cn(
            'rounded-full px-2.5 py-1 text-xs font-medium',
            CAMPAIGN_STATUS_COLORS[campaign.status],
          )}>
            {campaign.status}
          </span>
        </div>
        {/* Progress bar */}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-border/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{doneCount} / {tasks.length}</span>
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-3 max-w-2xl">
          {tasks.map(task => {
            const status = taskStatuses[task.id] ?? task.status;
            return (
              <TaskRow key={task.id} task={task} status={status} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task, status }: { task: CampaignTask; status: CampaignTask['status'] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn(
      'rounded-xl border transition-colors',
      STATUS_BORDER[status],
      STATUS_BG[status],
    )}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[status])} />
          <span className={cn('text-sm font-medium truncate', status === 'waiting' && 'text-muted-foreground')}>
            {task.title}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-3">
          <span className="text-xs text-muted-foreground">{AGENT_LABEL[task.agent]}</span>
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
