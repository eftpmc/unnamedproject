import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getCampaign } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '@/lib/utils';
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
    return (
      <div className="mt-2 w-64 rounded-xl border border-border/50 bg-background/60 p-3 text-xs text-muted-foreground animate-pulse">
        Loading campaign…
      </div>
    );
  }

  const { campaign, tasks } = data;
  const effectiveStatuses = tasks.map(t => taskStatuses[t.id] ?? t.status);
  const isRunning = effectiveStatuses.some(s => s === 'running') || campaign.status === 'running';
  const isDone = campaign.status === 'done';
  const isError = campaign.status === 'error';

  return (
    <div className="mt-2 w-64 overflow-hidden rounded-xl border border-border/50 bg-background/80 shadow-sm">
      {/* header */}
      <div className="flex items-center justify-between border-b border-border/40 bg-muted/30 px-3 py-2">
        <span className="text-xs font-semibold text-foreground truncate pr-2">{campaign.title}</span>
        <span className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
          isRunning && 'bg-blue-100 text-blue-700',
          isDone && 'bg-green-100 text-green-700',
          isError && 'bg-red-100 text-red-700',
          !isRunning && !isDone && !isError && 'bg-muted text-muted-foreground',
        )}>
          {campaign.status}
        </span>
      </div>
      {/* tasks */}
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        {tasks.map(task => {
          const status = taskStatuses[task.id] ?? task.status;
          return (
            <div key={task.id} className="flex items-center gap-2">
              <div className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[status])} />
              <span className="flex-1 truncate text-xs text-foreground/80">{task.title}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{AGENT_LABEL[task.agent]}</span>
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
    </div>
  );
}
