import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, FolderGit2, FileText, ChevronRight } from 'lucide-react';
import { getProjects, createProject, deleteProject } from '../lib/api.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import FileBrowser from '../components/FileBrowser.js';
import { cn } from '@/lib/utils';
import type { Project } from '../types.js';

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
  });

  const selectedProject = projects.find(p => p.id === selectedId) ?? null;

  const createMutation = useMutation({
    mutationFn: () => createProject({
      name: name.trim(),
      description: description.trim() || undefined,
      repo_path: repoPath.trim() || undefined,
      enabled_connection_ids: [],
    }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setCreating(false);
      setName('');
      setDescription('');
      setRepoPath('');
      setSelectedId(data.id);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setPendingDelete(null);
      if (selectedId === id) setSelectedId(null);
    },
    onError: () => setPendingDelete(null),
  });

  const inputCls = 'h-8 text-sm bg-background/60';

  if (isLoading) return null;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Left: project list */}
      <div className="flex w-64 shrink-0 flex-col border-r border-border/50">
        <header className="flex h-16 shrink-0 items-center justify-between px-4">
          <h1 className="text-sm font-medium">Projects</h1>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setCreating(v => !v)}>
            <Plus size={13} className="mr-1" />
            New
          </Button>
        </header>

        {creating && (
          <div className="shrink-0 border-b border-border/50 px-3 pb-3">
            <div className="flex flex-col gap-2 rounded-xl border border-border/50 bg-background/40 p-3">
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
                placeholder="Repo path (optional)"
                value={repoPath}
                onChange={e => setRepoPath(e.target.value)}
              />
              <div className="flex gap-2 pt-0.5">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={!name.trim() || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  Create
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="px-2 py-1">
            {projects.length === 0 && !creating && (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground/50">No projects yet</p>
            )}
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => setSelectedId(project.id === selectedId ? null : project.id)}
                className={cn(
                  'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                  selectedId === project.id
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50',
                )}
              >
                {project.repo_path
                  ? <FolderGit2 size={14} className="shrink-0 opacity-70" />
                  : <FileText size={14} className="shrink-0 opacity-70" />
                }
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{project.name}</div>
                  {project.description && (
                    <div className="truncate text-xs text-muted-foreground/60">{project.description}</div>
                  )}
                </div>
                <ChevronRight size={12} className="shrink-0 opacity-40" />
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Right: project detail */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!selectedProject ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground/40">
              {projects.length === 0 ? 'Create a project to get started' : 'Select a project'}
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Detail header */}
            <header className="flex h-16 shrink-0 items-center justify-between px-6">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {selectedProject.repo_path
                    ? <FolderGit2 size={15} className="shrink-0 text-muted-foreground" />
                    : <FileText size={15} className="shrink-0 text-muted-foreground" />
                  }
                  <h2 className="truncate text-sm font-medium">{selectedProject.name}</h2>
                </div>
                {selectedProject.repo_path && (
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground/50">{selectedProject.repo_path}</p>
                )}
                {selectedProject.description && !selectedProject.repo_path && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground/60">{selectedProject.description}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setPendingDelete(selectedProject.id)}
              >
                <Trash2 size={14} />
              </Button>
            </header>

            {/* File browser */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6">
              <FileBrowser projectId={selectedProject.id} />
            </div>
          </div>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete project?"
          description="This will permanently delete the project. Files on disk will not be removed."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
