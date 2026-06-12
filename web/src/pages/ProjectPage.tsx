import { useState } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitBranch, GitGraph, Video } from 'lucide-react';
import { getProjects, getProjectCampaigns, getProjectCapabilities, createChat, updateChatConfig, deleteProject, updateProject, getChats } from '../lib/api.js';
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
import { useProjectCapabilities } from '../hooks/useProjectCapabilities.js';
import type { Project, Campaign, Session } from '../types.js';

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

  const { data: allChats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });
  const pinnedChats = allChats.filter(c => c.pinned_project_id === projectId);

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

  const { tabs: extraTabs } = useProjectCapabilities(projectId ?? '');

  const { data: caps } = useQuery({
    queryKey: ['project-capabilities', projectId],
    queryFn: () => getProjectCapabilities(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  if (!project) {
    return (
      <PageShell>
        <PageLoading rows={3} />
      </PageShell>
    );
  }

  const runningCampaigns = campaigns.filter(c => c.status === 'running');
  const activeCampaign = runningCampaigns[0] ?? null;
  const recentCampaigns = campaigns.filter(c => c.id !== activeCampaign?.id);

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'campaigns', label: `Campaigns${campaigns.length > 0 ? ` (${campaigns.length})` : ''}` },
    { id: 'chats', label: `Chats${pinnedChats.length > 0 ? ` (${pinnedChats.length})` : ''}` },
    { id: 'files', label: 'Files' },
    ...extraTabs.map(t => ({ id: t.id, label: t.label })),
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <PageShell>
      <PageHeader
        title={project.name}
        description={project.description || undefined}
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
          <TabsList variant="line" className="-mx-1 px-1 self-start">
            {TABS.map(t => (
              <TabsTrigger key={t.id} value={t.id} className="shrink-0 px-3 py-2 text-xs">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <div className="max-w-4xl p-4 sm:p-6 flex flex-col gap-5">
            {/* 1. Active campaign hero */}
            {activeCampaign && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Active Campaign</div>
                <Link
                  to={`/projects/${projectId}/campaigns/${activeCampaign.id}`}
                  className="block rounded-xl border border-border/50 border-l-2 border-l-blue-500 bg-background/55 p-4 transition-colors hover:bg-background/85"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{activeCampaign.title}</span>
                    <Badge variant="outline" className={cn('capitalize', STATUS_BADGE[activeCampaign.status])}>
                      {activeCampaign.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Started {timeAgo(activeCampaign.created_at)}
                  </div>
                </Link>
              </div>
            )}

            {/* 2. Stats row */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Surface className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Campaigns</div>
                <div className="text-2xl font-semibold">{campaigns.length}</div>
                {runningCampaigns.length > 0 && (
                  <div className="text-xs text-blue-600 font-medium mt-0.5">{runningCampaigns.length} running</div>
                )}
              </Surface>
              <Surface className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Chats</div>
                <div className="text-2xl font-semibold">{pinnedChats.length}</div>
              </Surface>
              <Surface className="p-4">
                <div className="text-xs text-muted-foreground mb-1">MCP Tools</div>
                <div className="text-2xl font-semibold">{project.enabled_connection_ids.length}</div>
              </Surface>
            </div>

            {/* 3. Recent campaigns */}
            {recentCampaigns.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-muted-foreground">Recent Campaigns</div>
                  <Link
                    to={tabHref(project.id, 'campaigns')}
                    className="text-xs text-indigo-500 hover:text-indigo-400 transition-colors"
                  >
                    View all →
                  </Link>
                </div>
                <div className="overflow-hidden rounded-xl border border-border/50 bg-background/60 divide-y divide-border/50">
                  {recentCampaigns.slice(0, 3).map(c => (
                    <Link
                      key={c.id}
                      to={`/projects/${projectId}/campaigns/${c.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <span className="text-sm font-medium truncate">{c.title}</span>
                      <div className="flex items-center gap-3 shrink-0 ml-3">
                        <Badge variant="outline" className={cn('capitalize', STATUS_BADGE[c.status])}>
                          {c.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* 4. Recent chats */}
            {pinnedChats.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-muted-foreground">Recent Chats</div>
                  <Link
                    to={tabHref(project.id, 'chats')}
                    className="text-xs text-indigo-500 hover:text-indigo-400 transition-colors"
                  >
                    View all →
                  </Link>
                </div>
                <div className="overflow-hidden rounded-xl border border-border/50 bg-background/60 divide-y divide-border/50">
                  {pinnedChats.slice(0, 2).map(chat => (
                    <button
                      key={chat.id}
                      onClick={() => navigate(`/c/${chat.id}`)}
                      className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                    >
                      <span className="text-sm font-medium truncate">{chat.title ?? 'Untitled chat'}</span>
                      <span className="text-xs text-muted-foreground shrink-0 ml-3">{timeAgo(chat.updated_at)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 5. Capabilities */}
            {(caps?.has_graph || caps?.has_media || project.repo_path) && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Capabilities</div>
                <div className="flex flex-wrap gap-2">
                  {caps?.has_graph && (
                    <span className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/55 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <GitGraph size={11} className="shrink-0" />
                      graph indexed
                    </span>
                  )}
                  {caps?.has_media && (
                    <span className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/55 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <Video size={11} className="shrink-0" />
                      videos rendered
                    </span>
                  )}
                  {project.repo_path && (
                    <span className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/55 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <GitBranch size={11} className="shrink-0" />
                      {project.repo_path.split('/').pop()}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 6. Empty state */}
            {campaigns.length === 0 && pinnedChats.length === 0 && (
              <EmptyPanel
                title="Nothing here yet"
                description="Start a chat and ask the orchestrator to get to work. Campaigns and activity will appear here."
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

        {tab === 'chats' && (
          <div className="max-w-4xl p-4 sm:p-6">
            {pinnedChats.length === 0 ? (
              <EmptyPanel
                title="No chats yet"
                description="Start a chat from this project and it will appear here."
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border/50 bg-background/60 divide-y divide-border/50">
                {pinnedChats.map((chat) => (
                  <button
                    key={chat.id}
                    aria-label={`Open chat ${chat.title ?? 'Untitled chat'}`}
                    onClick={() => navigate(`/c/${chat.id}`)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                  >
                    <span className="text-sm font-medium truncate">
                      {chat.title ?? 'Untitled chat'}
                    </span>
                    <span className="shrink-0 ml-3 text-xs text-muted-foreground">
                      {timeAgo(chat.updated_at)}
                    </span>
                  </button>
                ))}
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
