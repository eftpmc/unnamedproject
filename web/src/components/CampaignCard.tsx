import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bot, FileEdit, GitBranch, GitPullRequest } from 'lucide-react';
import { getCampaign } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Surface } from '@/components/ui/app-layout';
import type { CampaignTask, WSCampaignTaskUpdated } from '../types.js';

interface CampaignCardProps {
  campaignId: string;
  projectId: string;
}

const STATUS_DOT: Record<CampaignTask['status'], string> = {
  waiting: 'bg-muted-foreground/30',
  running: 'bg-blue-500 animate-pulse',
  done: 'bg-green-500',
  error: 'bg-destructive',
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
    return <Skeleton className="mt-2 h-28 w-64 rounded-xl" />;
  }

  const { campaign, tasks } = data;
  const effectiveStatuses = tasks.map(t => taskStatuses[t.id] ?? t.status);
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
    <Surface className="mt-2 w-64 overflow-hidden bg-background/70 shadow-xs">
      {/* header */}
      <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-3 py-2">
        <span className="text-xs font-semibold text-foreground truncate pr-2">{campaign.title}</span>
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 capitalize',
            isRunning && 'bg-blue-500/10 text-blue-700 border-blue-200 dark:text-blue-300 dark:border-blue-900',
            isDone && 'bg-green-500/10 text-green-700 border-green-200 dark:text-green-300 dark:border-green-900',
            isError && 'bg-destructive/10 text-destructive border-destructive/20',
            !isRunning && !isDone && !isError && 'bg-muted text-muted-foreground border-transparent',
          )}
        >
          {displayStatus}
        </Badge>
      </div>
      {/* tasks */}
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        {tasks.map(task => {
          const status = taskStatuses[task.id] ?? task.status;
          return (
            <div key={task.id} className="flex items-center gap-2">
              <div className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[status])} />
              <span className="flex-1 truncate text-xs text-foreground/80">{task.title}</span>
              <span className="shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground">
                {(() => { const Icon = AGENT_ICON[task.agent]; return <Icon className="size-2.5" />; })()}
                {AGENT_LABEL[task.agent]}
              </span>
            </div>
          );
        })}
      </div>
      {/* link */}
      <div className="border-t border-border/40 px-3 py-2">
        <Link
          to={`/projects/${projectId}/campaigns/${campaignId}`}
          className="block text-center text-xs font-medium text-foreground/70 hover:text-foreground transition-colors"
        >
          View campaign →
        </Link>
      </div>
    </Surface>
  );
}
