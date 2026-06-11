import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FolderGit2, FileText, GitBranch } from 'lucide-react';
import { getProjects, getProjectCampaigns, createChat, updateChatConfig, deleteProject, updateProject } from '../lib/api.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import FileBrowser from '../components/FileBrowser.js';
import { timeAgo } from '../lib/utils.js';
import type { Project, Campaign } from '../types.js';

type Tab = 'overview' | 'campaigns' | 'files' | 'settings';

const STATUS_COLORS: Record<Campaign['status'], string> = {
  running: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  cancelled: 'bg-muted text-muted-foreground',
};

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
    staleTime: 30_000,
  });
  const project = projects.find(p => p.id === projectId) ?? null;

  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ['project-campaigns', projectId],
    queryFn: () => getProjectCampaigns(projectId!),
    enabled: !!projectId,
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

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(projectId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate('/projects');
    },
  });

  if (!project) return null;

  const runningCampaigns = campaigns.filter(c => c.status === 'running');
  const recentCampaign = campaigns[0] ?? null;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'campaigns', label: `Campaigns${campaigns.length > 0 ? ` (${campaigns.length})` : ''}` },
    { id: 'files', label: 'Files' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border/40 bg-background/60 px-6 pt-4 pb-0">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => navigate('/projects')} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={15} />
          </button>
          <span className="text-xs text-muted-foreground">Projects</span>
          <span className="text-xs text-muted-foreground/40">/</span>
          <span className="text-xs text-foreground font-medium">{project.name}</span>
        </div>
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              {project.repo_path
                ? <FolderGit2 size={15} className="text-muted-foreground" />
                : <FileText size={15} className="text-muted-foreground" />
              }
              <h1 className="text-base font-semibold">{project.name}</h1>
              <span className="text-xs text-muted-foreground/50 bg-muted/50 rounded px-1.5 py-0.5">
                {project.repo_path ? 'code repo' : 'doc project'}
              </span>
            </div>
            {project.description && (
              <p className="mt-0.5 text-xs text-muted-foreground ml-[23px]">{project.description}</p>
            )}
          </div>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => startChatMutation.mutate()}
            disabled={startChatMutation.isPending}
          >
            Start chat
          </Button>
        </div>
        {/* Tabs */}
        <div className="flex gap-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-4 py-2 text-xs font-medium border-b-2 transition-colors',
                tab === t.id
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <div className="p-6 max-w-3xl">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="rounded-xl border border-border/50 bg-background/60 p-4">
                <div className="text-xs text-muted-foreground mb-1">Campaigns</div>
                <div className="text-2xl font-semibold">{campaigns.length}</div>
                {runningCampaigns.length > 0 && (
                  <div className="text-xs text-blue-600 font-medium mt-0.5">{runningCampaigns.length} running</div>
                )}
              </div>
              <div className="rounded-xl border border-border/50 bg-background/60 p-4">
                <div className="text-xs text-muted-foreground mb-1">MCP tools</div>
                <div className="text-2xl font-semibold">
                  {project.enabled_connection_ids.length}
                </div>
              </div>
              {project.repo_path && (
                <div className="rounded-xl border border-border/50 bg-background/60 p-4">
                  <div className="text-xs text-muted-foreground mb-1">Repo</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <GitBranch size={12} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground truncate">{project.repo_path.split('/').pop()}</span>
                  </div>
                </div>
              )}
            </div>
            {/* Recent campaign */}
            {recentCampaign && (
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Recent campaign</div>
                <Link
                  to={`/projects/${projectId}/campaigns/${recentCampaign.id}`}
                  className="block rounded-xl border border-border/50 bg-background/60 p-4 hover:border-border hover:bg-background/90 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{recentCampaign.title}</span>
                    <span className={cn('text-[10px] font-medium rounded-full px-2 py-0.5', STATUS_COLORS[recentCampaign.status])}>
                      {recentCampaign.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Started {timeAgo(recentCampaign.created_at)}
                  </div>
                </Link>
              </div>
            )}
            {campaigns.length === 0 && (
              <p className="text-sm text-muted-foreground/60">No campaigns yet. Start a chat to kick one off.</p>
            )}
          </div>
        )}

        {tab === 'campaigns' && (
          <div className="p-6 max-w-3xl">
            {campaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground/60">No campaigns yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {campaigns.map(c => (
                  <Link
                    key={c.id}
                    to={`/projects/${projectId}/campaigns/${c.id}`}
                    className="flex items-center justify-between rounded-xl border border-border/50 bg-background/60 px-4 py-3 hover:border-border hover:bg-background/90 transition-all"
                  >
                    <div>
                      <div className="text-sm font-medium">{c.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{timeAgo(c.created_at)}</div>
                    </div>
                    <span className={cn('text-[10px] font-medium rounded-full px-2 py-0.5', STATUS_COLORS[c.status])}>
                      {c.status}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'files' && (
          <div className="p-6">
            <FileBrowser projectId={projectId!} />
          </div>
        )}

        {tab === 'settings' && (
          <div className="p-6 max-w-lg">
            <ProjectSettingsForm project={project} onDelete={() => deleteMutation.mutate()} />
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectSettingsForm({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState(project.description ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const updateMutation = useMutation({
    mutationFn: () => updateProject(project.id, { description: description.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
          <Input value={project.name} disabled />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        {project.repo_path && (
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Repo path</label>
            <Input value={project.repo_path} disabled className="font-mono text-xs" />
          </div>
        )}
        <Button
          size="sm"
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending}
          className="w-fit"
        >
          Save changes
        </Button>
      </div>
      <div className="border-t border-border/40 pt-5">
        <div className="text-xs font-medium text-muted-foreground mb-2">Danger zone</div>
        {!confirmDelete ? (
          <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
            Delete project
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="destructive" onClick={onDelete}>Confirm delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </div>
        )}
      </div>
    </div>
  );
}
