import { useState } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import { getProjects, getProjectCampaigns, createChat, updateChatConfig, deleteProject, updateProject } from '../lib/api.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EmptyPanel, PageHeader, PageLoading, PageShell, Surface } from '@/components/ui/app-layout';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import FileBrowser from '../components/FileBrowser.js';
import { timeAgo } from '../lib/utils.js';
import { getProjectTypeConfig } from '../projectTypes.js';
import type { Project, Campaign } from '../types.js';

type Tab = string;

const STATUS_BADGE: Record<Campaign['status'], string> = {
  running: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900',
  done: 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900',
  error: 'bg-destructive/10 text-destructive border-destructive/20',
  cancelled: 'bg-muted text-muted-foreground border-transparent',
};

function tabFromPath(pathname: string): Tab {
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (last === 'campaigns' || last === 'files' || last === 'settings') return last;
  // Any other trailing segment after the project id is treated as an extra tab id.
  if (segments.length >= 3 && segments[0] === 'projects') return last;
  return 'overview';
}

function tabHref(projectId: string, tab: Tab) {
  if (tab === 'overview') return `/projects/${projectId}`;
  return `/projects/${projectId}/${tab}`;
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const tab = tabFromPath(location.pathname);

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

  if (!project) {
    return (
      <PageShell>
        <PageLoading rows={3} />
      </PageShell>
    );
  }

  const runningCampaigns = campaigns.filter(c => c.status === 'running');
  const recentCampaign = campaigns[0] ?? null;

  const extraTabs = getProjectTypeConfig(project.type).extraTabs;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'campaigns', label: `Campaigns${campaigns.length > 0 ? ` (${campaigns.length})` : ''}` },
    { id: 'files', label: 'Files' },
    ...extraTabs.map(t => ({ id: t.id, label: t.label })),
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <PageShell>
      <PageHeader
        title={project.name}
        description={[project.description, project.repo_path].filter(Boolean).join(' · ') || undefined}
        actions={
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => startChatMutation.mutate()}
            disabled={startChatMutation.isPending}
          >
            Start chat
          </Button>
        }
      />
      {/* Tab strip */}
      <div className="shrink-0 overflow-x-auto border-b border-border/40 px-4 sm:px-6">
        <Tabs value={tab} onValueChange={value => navigate(tabHref(project.id, value as Tab))}>
          <TabsList variant="line" className="-mx-1 px-1">
            {TABS.map(t => (
              <TabsTrigger key={t.id} value={t.id} className="px-3 py-2 text-xs">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <div className="max-w-4xl p-4 sm:p-6">
            {/* Stats */}
            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Surface className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Campaigns</div>
                <div className="text-2xl font-semibold">{campaigns.length}</div>
                {runningCampaigns.length > 0 && (
                  <div className="text-xs text-blue-600 font-medium mt-0.5">{runningCampaigns.length} running</div>
                )}
              </Surface>
              <Surface className="p-4">
                <div className="text-xs text-muted-foreground mb-1">MCP tools</div>
                <div className="text-2xl font-semibold">
                  {project.enabled_connection_ids.length}
                </div>
              </Surface>
              {project.repo_path && (
                <Surface className="p-4">
                  <div className="text-xs text-muted-foreground mb-1">Repo</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <GitBranch size={12} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground truncate">{project.repo_path.split('/').pop()}</span>
                  </div>
                </Surface>
              )}
            </div>
            {recentCampaign && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Recent campaign</div>
                <Link
                  to={`/projects/${projectId}/campaigns/${recentCampaign.id}`}
                  className="block rounded-xl border border-border/50 bg-background/55 p-4 transition-colors hover:border-border hover:bg-background/85"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{recentCampaign.title}</span>
                    <Badge variant="outline" className={cn('capitalize', STATUS_BADGE[recentCampaign.status])}>
                      {recentCampaign.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Started {timeAgo(recentCampaign.created_at)}
                  </div>
                </Link>
              </div>
            )}
            {campaigns.length === 0 && (
              <EmptyPanel
                title="No campaigns yet"
                description="When a chat delegates multi-step work, campaign progress will appear here."
              />
            )}
          </div>
        )}

        {tab === 'campaigns' && (
          <div className="max-w-4xl p-4 sm:p-6">
            {campaigns.length === 0 ? (
              <EmptyPanel
                title="No campaigns yet"
                description="Campaigns are created when the agent coordinates multi-step work for this project."
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border/50 bg-background/60">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden sm:table-cell">Started</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map(c => (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/projects/${projectId}/campaigns/${c.id}`)}
                      >
                        <TableCell className="font-medium">
                          <Link to={`/projects/${projectId}/campaigns/${c.id}`} className="hover:underline">
                            {c.title}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('capitalize', STATUS_BADGE[c.status])}>
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">
                          {timeAgo(c.created_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {tab === 'files' && (
          <div className="p-4 sm:p-6">
            <FileBrowser projectId={projectId!} />
          </div>
        )}

        {extraTabs.map(t => (
          tab === t.id && (
            <div key={t.id} className="p-4 sm:p-6">
              <t.component project={project} />
            </div>
          )
        ))}

        {tab === 'settings' && (
          <div className="p-4 sm:p-6 max-w-lg">
            <ProjectSettingsForm project={project} onDelete={() => deleteMutation.mutate()} />
          </div>
        )}
      </div>
    </PageShell>
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
