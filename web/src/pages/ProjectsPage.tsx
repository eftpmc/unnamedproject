import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderGit2, FileText, Search, Video, GitGraph } from 'lucide-react';
import { getProjects, createProject, getProjectPlans, getProjectCapabilities } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CenteredEmptyState, ContentColumn, PageBody, PageHeader, PageLoading, PageShell, Surface } from '@/components/ui/app-layout';
import type { Project } from '../types.js';

function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const { data: plans = [] } = useQuery({
    queryKey: ['project-plans', project.id],
    queryFn: () => getProjectPlans(project.id),
    staleTime: 30_000,
  });
  const { data: caps } = useQuery({
    queryKey: ['project-capabilities', project.id],
    queryFn: () => getProjectCapabilities(project.id),
    staleTime: 30_000,
  });
  const runningCount = plans.filter(p => p.status === 'running').length;

  return (
    <button type="button" aria-label={`Open project: ${project.name}`} className="block h-full w-full rounded-lg text-left" onClick={() => navigate(`/projects/${project.id}`)}>
      <Surface interactive className="flex h-full flex-col gap-2.5 rounded-lg p-4">
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {project.repo_path
              ? <FolderGit2 size={16} className="shrink-0 text-muted-foreground" />
              : <FileText size={16} className="shrink-0 text-muted-foreground" />
            }
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">{project.name}</span>
          </div>
          {runningCount > 0 && (
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-on-accent-soft">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              {runningCount} running
            </span>
          )}
        </div>
        {project.description && (
          <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{project.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint-fg">
          <span>{project.repo_path ? 'code repo' : 'doc project'}</span>
          {caps?.has_graph && (
            <span className="flex items-center gap-1">
              <span className="text-border">·</span>
              <GitGraph size={10} className="shrink-0" />
              graph
            </span>
          )}
          {caps?.has_media && (
            <span className="flex items-center gap-1">
              <span className="text-border">·</span>
              <Video size={10} className="shrink-0" />
              videos
            </span>
          )}
          <span className="text-border">·</span>
          <span>{plans.length} plan{plans.length !== 1 ? 's' : ''}</span>
        </div>
      </Surface>
    </button>
  );
}

export default function ProjectsPage() {
  usePageTitle('Projects');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [search, setSearch] = useState('');

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
  });
  const filteredProjects = search.trim()
    ? projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.description?.toLowerCase().includes(search.toLowerCase()))
    : projects;

  const createMutation = useMutation({
    mutationFn: () => createProject({
      name: name.trim(),
      description: description.trim() || undefined,
      repo_path: repoPath.trim() || undefined,
      enabled_connection_ids: [],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      setName(''); setDescription(''); setRepoPath('');
    },
  });

  return (
    <PageShell>
      <PageHeader
        title="Projects"
        actions={(
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-[13px] font-medium text-fg-soft transition-colors hover:border-muted-foreground hover:bg-card hover:text-foreground"
            onClick={() => setOpen(true)}
          >
            <Plus size={14} />
            New project
          </button>
        )}
      />

      {isLoading ? (
        <PageLoading rows={3} />
      ) : projects.length === 0 ? (
        <CenteredEmptyState
          title="No projects yet"
          description="Create a project to give the agent a workspace, repo context, and saved settings."
          actionLabel="Create your first project"
          onAction={() => setOpen(true)}
        />
      ) : (
        <PageBody>
          <ContentColumn>
            {projects.length > 4 && (
              <div className="relative mb-5">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint-fg pointer-events-none" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Filter projects…"
                  className="w-full max-w-sm rounded-lg border border-border-soft bg-card py-2 pl-8 pr-3 text-sm text-foreground placeholder:text-faint-fg focus:border-border focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
                />
              </div>
            )}
            {filteredProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No projects matched "{search}".</p>
            ) : (
              <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(15.5rem,1fr))]">
                {filteredProjects.map(p => <ProjectCard key={p.id} project={p} />)}
              </div>
            )}
          </ContentColumn>
        </PageBody>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Input
              placeholder="Project name"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
            <Input
              placeholder="Description (optional)"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
            <Input
              placeholder="Repo path (optional, e.g. /Users/me/code/my-app)"
              value={repoPath}
              onChange={e => setRepoPath(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!name.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
