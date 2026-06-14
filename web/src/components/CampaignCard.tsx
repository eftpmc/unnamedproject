import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Bot, CheckCircle2, Circle, FileEdit, GitBranch, GitPullRequest, LoaderCircle, Terminal, Cpu } from 'lucide-react';
import { getCampaign } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Surface } from '@/components/ui/app-layout';
import type { CampaignTask, WSCampaignTaskUpdated } from '../types.js';

interface CampaignCardProps {
  campaignId: string;
  projectId: string;
}

const STATUS_ICON: Record<CampaignTask['status'], typeof Circle> = {
  waiting: Circle,
  running: LoaderCircle,
  done: CheckCircle2,
  error: AlertCircle,
};

const STATUS_ICON_CLASS: Record<CampaignTask['status'], string> = {
  waiting: 'text-muted-foreground/40',
  running: 'text-primary animate-spin',
  done: 'text-success',
  error: 'text-destructive',
};

const AGENT_LABEL: Record<CampaignTask['agent'], string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  mcp: 'MCP',
  file_write: 'Write File',
  git: 'Git',
  github: 'GitHub',
  eval: 'Eval',
  subagent: 'Sub-agent',
};

const AGENT_ICON: Record<CampaignTask['agent'], typeof Bot> = {
  claude_code: Bot,
  codex: Bot,
  mcp: Bot,
  file_write: FileEdit,
  git: GitBranch,
  github: GitPullRequest,
  eval: Terminal,
  subagent: Cpu,
};

export default function CampaignCard({ campaignId, projectId }: CampaignCardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => getCampaign(campaignId),
    staleTime: 60_000,
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

  if (isLoading || !data) {
    return <Skeleton className="h-28 w-full rounded-2xl" />;
  }

  const { campaign, tasks } = data;
  const orderedTasks = [...tasks].sort((a, b) => a.position - b.position);
  const effectiveStatuses = orderedTasks.map(t => taskStatuses[t.id] ?? t.status);
  // Derive the displayed status from live task updates rather than the
  // (possibly stale) campaign.status fetched on initial load — the campaign
  // row is only updated server-side once all tasks settle, but WS task
  // updates arrive immediately.
  const allDone = effectiveStatuses.every(s => s === 'done');
  const anyError = effectiveStatuses.some(s => s === 'error');
  const anyRunning = effectiveStatuses.some(s => s === 'running');
  const isRunning = anyRunning || (campaign.status === 'running' && !allDone && !anyError);
  const isDone = allDone || (campaign.status === 'done' && !anyRunning);
  const isError = (anyError && !anyRunning) || (campaign.status === 'error' && !anyRunning);
  const displayStatus = isDone ? 'done' : isError ? 'error' : isRunning ? 'running' : campaign.status;

  return (
    <Surface className="w-full overflow-hidden rounded-lg border-border-soft bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border-soft px-3.5 py-2.5">
        <span className="text-xs font-semibold text-foreground truncate pr-2">{campaign.title}</span>
        <StatusPill status={displayStatus} />
      </div>
      <div className="flex flex-col gap-2 px-3.5 py-3">
        {orderedTasks.map(task => {
          const status = taskStatuses[task.id] ?? task.status;
          const StatusIcon = STATUS_ICON[status];
          const AgentIcon = AGENT_ICON[task.agent];
          return (
            <div key={task.id} className="flex min-w-0 items-center gap-2">
              <StatusIcon size={13} className={cn('shrink-0', STATUS_ICON_CLASS[status])} />
              <span className="flex-1 truncate text-xs text-foreground/80">{task.title}</span>
              <span className="shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground">
                <AgentIcon className="size-2.5" />
                {AGENT_LABEL[task.agent]}
              </span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-border-soft px-3.5 py-2">
        <Link
          to={`/projects/${projectId}/campaigns/${campaignId}`}
          className="flex items-center justify-center gap-1.5 text-xs font-medium text-foreground/70 transition-colors hover:text-foreground"
        >
          View campaign
          <ArrowRight size={12} />
        </Link>
      </div>
    </Surface>
  );
}
