import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderGit2, FileText } from 'lucide-react';
import { getProjects, createProject, getProjectCampaigns } from '../lib/api.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
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
    <button
      onClick={() => navigate(`/projects/${project.id}`)}
      className="group flex flex-col gap-3 rounded-2xl border border-border/50 bg-background/60 p-5 text-left shadow-sm transition-all hover:border-border hover:bg-background/90 hover:shadow-md"
    >
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

  if (isLoading) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between px-6 border-b border-border/40">
        <h1 className="text-sm font-semibold">Projects</h1>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setOpen(true)}>
          <Plus size={13} />
          New project
        </Button>
      </header>

      {projects.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground/60">No projects yet.</p>
          <Button size="sm" onClick={() => setOpen(true)}>Create your first project</Button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl">
            {projects.map(p => <ProjectCard key={p.id} project={p} />)}
          </div>
        </div>
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
    </div>
  );
}
