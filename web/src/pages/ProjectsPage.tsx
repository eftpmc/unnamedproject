import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderGit2, FileText } from 'lucide-react';
import { getProjects, createProject, getProjectCampaigns } from '../lib/api.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CenteredEmptyState, PageBody, PageHeader, PageLoading, PageShell, Surface } from '@/components/ui/app-layout';
import type { Project } from '../types.js';

function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const { data: campaigns = [] } = useQuery({
    queryKey: ['project-campaigns', project.id],
    queryFn: () => getProjectCampaigns(project.id),
    staleTime: 30_000,
  });
  const runningCount = campaigns.filter(c => c.status === 'running').length;

  return (
    <button className="block w-full rounded-xl text-left" onClick={() => navigate(`/projects/${project.id}`)}>
      <Surface interactive className="flex flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            {project.repo_path
              ? <FolderGit2 size={16} className="shrink-0 text-muted-foreground" />
              : <FileText size={16} className="shrink-0 text-muted-foreground" />
            }
            <span className="font-semibold text-sm text-foreground">{project.name}</span>
          </div>
          {runningCount > 0 && (
            <div className="flex items-center gap-1 shrink-0">
              <span className="size-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-[10px] text-blue-600 font-medium">{runningCount} running</span>
            </div>
          )}
        </div>
        {project.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{project.description}</p>
        )}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60">
          <span>{project.repo_path ? 'code repo' : 'doc project'}</span>
          {campaigns.length > 0 && (
            <span>{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      </Surface>
    </button>
  );
}

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repoPath, setRepoPath] = useState('');

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
  });

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
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setOpen(true)}>
            <Plus size={13} />
            New project
          </Button>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl">
            {projects.map(p => <ProjectCard key={p.id} project={p} />)}
          </div>
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
