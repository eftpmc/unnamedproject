import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, ChevronRight, Cpu, FileEdit, GitBranch, GitPullRequest, Play, Terminal, Trash2, Workflow } from 'lucide-react';
import { getPipelines, deletePipeline, runPipeline, getProjects } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ContentColumn, EmptyPanel, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { CampaignTask, Pipeline, Project } from '../types.js';

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

function RunDialog({
  pipeline,
  onClose,
}: {
  pipeline: Pipeline;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [selectedProject, setSelectedProject] = useState<string>('');

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
    staleTime: 30_000,
  });

  const runMutation = useMutation({
    mutationFn: () => runPipeline(pipeline.id, selectedProject),
    onSuccess: ({ campaign_id, project_id }) => {
      navigate(`/projects/${project_id}/campaigns/${campaign_id}`);
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
          <label className="mb-1.5 block text-xs font-medium text-foreground">Project</label>
          <select
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            className="w-full rounded-lg border border-border-soft bg-card py-2 pl-3 pr-8 text-sm text-foreground focus:border-border focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Select a project…</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {runMutation.isError && (
            <p className="mt-2 text-xs text-destructive">Failed to start pipeline run.</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-soft px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={!selectedProject || runMutation.isPending}
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

export default function PipelinesPage() {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [runningPipeline, setRunningPipeline] = useState<Pipeline | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pipelines'],
    queryFn: getPipelines,
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: deletePipeline,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      setPendingDelete(null);
    },
    onError: () => setPendingDelete(null),
  });

  const pipelines = data?.pipelines ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Pipelines"
        description="Saved, reusable workflows. Run them against any project whenever you need."
      />

      {isLoading ? (
        <PageLoading rows={4} />
      ) : (
        <PageBody>
          <ContentColumn className="max-w-2xl">
            {pipelines.length === 0 ? (
              <EmptyPanel
                title="No pipelines yet"
                description='Create a pipeline by asking the agent — e.g. "Create a pipeline that runs tests, fixes issues, then opens a PR."'
              />
            ) : (
              <div className="flex flex-col gap-2">
                {pipelines.map(pipeline => (
                  <PipelineRow
                    key={pipeline.id}
                    pipeline={pipeline}
                    onRun={() => setRunningPipeline(pipeline)}
                    onDelete={() => setPendingDelete(pipeline.id)}
                  />
                ))}
              </div>
            )}
          </ContentColumn>
        </PageBody>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete pipeline?"
          description="This removes the pipeline template. Campaigns already created from it are not affected."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {runningPipeline && (
        <RunDialog
          pipeline={runningPipeline}
          onClose={() => setRunningPipeline(null)}
        />
      )}
    </PageShell>
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
  const agents = pipeline.agents ?? [];
  const uniqueAgents = [...new Set(agents)].slice(0, 4);

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3.5 transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
        <Workflow size={15} className="text-muted-foreground" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{pipeline.title}</div>
        <div className="mt-0.5 flex items-center gap-2">
          {pipeline.description && (
            <span className="truncate text-xs text-muted-foreground">{pipeline.description}</span>
          )}
          {!pipeline.description && (
            <span className="text-xs text-faint-fg">{pipeline.task_count ?? 0} steps · {timeAgo(pipeline.created_at)}</span>
          )}
        </div>
        {uniqueAgents.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1">
            {uniqueAgents.map(agent => {
              const Icon = AGENT_ICON[agent];
              return (
                <span
                  key={agent}
                  title={AGENT_LABEL[agent]}
                  className="flex items-center gap-1 rounded border border-border-soft bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  <Icon size={9} />
                  {AGENT_LABEL[agent]}
                </span>
              );
            })}
            {(pipeline.agents?.length ?? 0) > 4 && (
              <span className="text-[10px] text-faint-fg">+{(pipeline.agents?.length ?? 0) - 4} more</span>
            )}
          </div>
        )}
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
        <ChevronRight size={14} className="shrink-0 text-faint-fg transition-colors group-hover:text-muted-foreground" />
      </div>
    </div>
  );
}
