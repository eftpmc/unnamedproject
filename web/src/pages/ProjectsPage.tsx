import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderGit2, GitBranch, Plus } from 'lucide-react';
import { getProjects, createTopLevelProject, deleteTopLevelProject } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { timeAgo } from '../lib/utils.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CenteredEmptyState, ContentColumn, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { Project } from '../types.js';

export default function ProjectsPage() {
  usePageTitle('Projects');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [branch, setBranch] = useState('');

  const { data: projects = [], isLoading } = useQuery<Project[]>({ queryKey: ['projects'], queryFn: getProjects });

  const createMutation = useMutation({
    mutationFn: () => createTopLevelProject({
      name: name.trim(),
      ...(repoPath.trim() ? { repo_path: repoPath.trim() } : {}),
      ...(branch.trim() ? { default_branch: branch.trim() } : {}),
    }),
    onSuccess: project => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      setName(''); setRepoPath(''); setBranch('');
      navigate(`/projects/${project.id}`);
    },
  });

  return (
    <PageShell>
      <PageHeader
        title="Projects"
        className="border-0 pb-0"
        contentClassName="max-w-5xl"
        actions={
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setOpen(true)}>
            <Plus size={14} />New project
          </Button>
        }
      />

      {isLoading ? <PageLoading rows={3} /> : projects.length === 0 ? (
        <CenteredEmptyState
          title="No projects yet"
          description="Create a project or link a local git repository."
          actionLabel="New project"
          onAction={() => setOpen(true)}
        />
      ) : (
        <PageBody>
          <ContentColumn className="max-w-5xl">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map(project => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="flex flex-col gap-3 rounded-xl border border-border-soft bg-card p-4 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-400">
                      <FolderGit2 size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{project.name}</span>
                      {project.default_branch && (
                        <span className="flex items-center gap-1 text-[11px] text-faint-fg">
                          <GitBranch size={10} />{project.default_branch}
                        </span>
                      )}
                    </span>
                  </div>
                  {project.repo_path && (
                    <span className="truncate font-mono text-[11px] text-faint-fg">{project.repo_path}</span>
                  )}
                </button>
              ))}
            </div>
          </ContentColumn>
        </PageBody>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Create empty or link an existing repository.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Input placeholder="Project name" value={name} onChange={e => setName(e.target.value)} autoFocus />
            <Input placeholder="Local repo path (optional)" value={repoPath} onChange={e => setRepoPath(e.target.value)} />
            <Input placeholder="Default branch (optional)" value={branch} onChange={e => setBranch(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!name.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
