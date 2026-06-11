import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { getProjects, createProject, deleteProject } from '../lib/api.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { Project } from '../types.js';

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

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
      setCreating(false);
      setName('');
      setDescription('');
      setRepoPath('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setPendingDelete(null);
    },
    onError: () => setPendingDelete(null),
  });

  const inputCls = 'h-8 text-sm bg-background/60';

  if (isLoading) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between px-6">
        <h1 className="text-sm font-medium">Projects</h1>
        <Button size="sm" variant="outline" onClick={() => setCreating(v => !v)}>
          <Plus size={14} className="mr-1" />
          New project
        </Button>
      </header>

      {creating && (
        <div className="shrink-0 border-b border-border/50 px-6 pb-4">
          <div className="flex flex-col gap-2 rounded-2xl border border-border/50 bg-background/40 p-4">
            <Input
              className={inputCls}
              placeholder="Project name"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
            <Input
              className={inputCls}
              placeholder="Description (optional)"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
            <Input
              className={inputCls}
              placeholder="Repo path (optional, e.g. /Users/you/myproject)"
              value={repoPath}
              onChange={e => setRepoPath(e.target.value)}
            />
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                disabled={!name.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {projects.length === 0 && !creating ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-muted-foreground/60">No projects yet.</p>
            <Button className="mt-3" size="sm" onClick={() => setCreating(true)}>
              New project
            </Button>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="px-6 pb-6">
            <div className="divide-y divide-border/50 rounded-2xl border border-border/50 bg-background/40">
              {projects.map((project: Project) => (
                <div key={project.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{project.name}</div>
                    {project.description && (
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{project.description}</div>
                    )}
                    {project.repo_path && (
                      <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground/60">{project.repo_path}</div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${project.name}`}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingDelete(project.id)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete project?"
          description="This will permanently delete the project. The repo files on disk will not be removed."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
