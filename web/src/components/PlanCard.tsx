import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Bot, CheckCircle2, Circle, FileEdit, GitBranch, GitPullRequest, LoaderCircle, Terminal, Cpu } from 'lucide-react';
import { getPlan } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Surface } from '@/components/ui/app-layout';
import type { PlanStep, WSPlanStepUpdated } from '../types.js';

interface PlanCardProps {
  planId: string;
  projectId: string;
}

const STATUS_ICON: Record<PlanStep['status'], typeof Circle> = {
  waiting: Circle,
  running: LoaderCircle,
  done: CheckCircle2,
  error: AlertCircle,
};

const STATUS_ICON_CLASS: Record<PlanStep['status'], string> = {
  waiting: 'text-muted-foreground/40',
  running: 'text-primary animate-spin',
  done: 'text-success',
  error: 'text-destructive',
};

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

export default function PlanCard({ planId, projectId }: PlanCardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['plan', planId],
    queryFn: () => getPlan(planId),
    staleTime: 60_000,
  });

  const [stepStatuses, setStepStatuses] = useState<Record<string, PlanStep['status']>>({});

  useEffect(() => {
    if (data) {
      const initial: Record<string, PlanStep['status']> = {};
      data.steps.forEach(s => { initial[s.id] = s.status; });
      setStepStatuses(initial);
    }
  }, [data]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === 'plan_step_updated') {
        const e = event as WSPlanStepUpdated;
        setStepStatuses(prev => ({ ...prev, [e.stepId]: e.status }));
      }
    });
  }, []);

  if (isLoading || !data) {
    return <Skeleton className="h-28 w-full rounded-2xl" />;
  }

  const { plan, steps } = data;
  const orderedSteps = [...steps].sort((a, b) => a.position - b.position);
  const effectiveStatuses = orderedSteps.map(s => stepStatuses[s.id] ?? s.status);
  // Derive the displayed status from live step updates rather than the
  // (possibly stale) plan.status fetched on initial load — the plan
  // row is only updated server-side once all steps settle, but WS step
  // updates arrive immediately.
  const allDone = effectiveStatuses.every(s => s === 'done');
  const anyError = effectiveStatuses.some(s => s === 'error');
  const anyRunning = effectiveStatuses.some(s => s === 'running');
  const isRunning = anyRunning || (plan.status === 'running' && !allDone && !anyError);
  const isDone = allDone || (plan.status === 'done' && !anyRunning);
  const isError = (anyError && !anyRunning) || (plan.status === 'error' && !anyRunning);
  const displayStatus = isDone ? 'done' : isError ? 'error' : isRunning ? 'running' : plan.status;

  return (
    <Surface className="w-full overflow-hidden rounded-lg border-border-soft bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border-soft px-3.5 py-2.5">
        <span className="text-xs font-semibold text-foreground truncate pr-2">{plan.title}</span>
        <StatusPill status={displayStatus} />
      </div>
      <div className="flex flex-col gap-2 px-3.5 py-3">
        {orderedSteps.map(step => {
          const status = stepStatuses[step.id] ?? step.status;
          const StatusIcon = STATUS_ICON[status];
          const AgentIcon = AGENT_ICON[step.agent];
          return (
            <div key={step.id} className="flex min-w-0 items-center gap-2">
              <StatusIcon size={13} className={cn('shrink-0', STATUS_ICON_CLASS[status])} />
              <span className="flex-1 truncate text-xs text-foreground/80">{step.title}</span>
              <span className="shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground">
                <AgentIcon className="size-2.5" />
                {AGENT_LABEL[step.agent]}
              </span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-border-soft px-3.5 py-2">
        <Link
          to={`/projects/${projectId}/plans/${planId}`}
          className="flex items-center justify-center gap-1.5 text-xs font-medium text-foreground/70 transition-colors hover:text-foreground"
        >
          View plan
          <ArrowRight size={12} />
        </Link>
      </div>
    </Surface>
  );
}
