import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { deleteTopLevelProject, getProjects, updateProject } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, DataTableBody, DataTableHeader, DataTableRow } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CenteredEmptyState, ContentColumn, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { Project } from '../types.js';

export default function ProjectsPage() {
  usePageTitle('Projects');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { data: projects = [], isLoading } = useQuery<Project[]>({ queryKey: ['projects'], queryFn: () => getProjects() });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateProject(id, { name }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['projects'] }); setRenaming(null); },
    onError: () => setRenaming(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (projectId: string) => deleteTopLevelProject(projectId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['projects'] }); setPendingDelete(null); },
    onError: () => setPendingDelete(null),
  });

  function commitRename() {
    if (!renaming) return;
    const trimmed = renaming.value.trim();
    if (!trimmed) { setRenaming(null); return; }
    const original = projects.find(p => p.id === renaming.id)?.name;
    if (trimmed === original) { setRenaming(null); return; }
    renameMutation.mutate({ id: renaming.id, name: trimmed });
  }

  return (
    <PageShell>
      <PageHeader
        title="Projects"
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
        actions={
          <Button size="lg" className="h-9 gap-2 rounded-lg px-3 text-sm shadow-sm" onClick={() => navigate('/projects/new')}>
            <Plus size={16} />New project
          </Button>
        }
      />

      {isLoading ? <PageLoading rows={3} /> : projects.length === 0 ? (
        <CenteredEmptyState
          title="No projects yet"
          description="Create a project or link a local git repository."
          actionLabel="New project"
          onAction={() => navigate('/projects/new')}
        />
      ) : (
        <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
          <ContentColumn className="max-w-7xl">
            <DataTable>
              <DataTableHeader className="grid-cols-[minmax(0,1fr)_1.75rem] sm:grid-cols-[minmax(0,1fr)_8rem_1.75rem] lg:grid-cols-[minmax(0,1fr)_8rem_7rem_1.75rem]">
                <span>Name</span>
                <span className="hidden sm:block">Branch</span>
                <span className="hidden lg:block">Origin</span>
                <span />
              </DataTableHeader>
              <DataTableBody>
                {projects.map(project => (
                  <DataTableRow
                    key={project.id}
                    className="grid-cols-[minmax(0,1fr)_1.75rem] sm:grid-cols-[minmax(0,1fr)_8rem_1.75rem] lg:grid-cols-[minmax(0,1fr)_8rem_7rem_1.75rem]"
                  >
                    <div className="min-w-0">
                      {renaming?.id === project.id ? (
                        <input
                          ref={renameInputRef}
                          className="w-full rounded border border-ring bg-background px-1 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring/50"
                          value={renaming.value}
                          onChange={e => setRenaming(r => r ? { ...r, value: e.target.value } : r)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                            if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); }
                          }}
                          onBlur={commitRename}
                        />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => navigate(`/projects/${project.id}`)}
                            className="block min-w-0 truncate text-left text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                          >
                            {project.name}
                          </button>
                          <div className="mt-0.5 flex gap-2 text-[11px] text-faint-fg sm:hidden">
                            <span className="truncate">{project.default_branch ?? 'Not set'}</span>
                            <span className="shrink-0">·</span>
                            <span className="truncate">{project.origin === 'linked' ? 'Linked repo' : 'Created'}</span>
                          </div>
                        </>
                      )}
                    </div>
                    <span className="hidden truncate text-xs text-muted-foreground sm:block">{project.default_branch ?? 'Not set'}</span>
                    <span className="hidden truncate text-xs text-muted-foreground lg:block">{project.origin === 'linked' ? 'Linked repo' : 'Created'}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Options for ${project.name}`}
                          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onSelect={() => { setRenaming({ id: project.id, value: project.name }); setTimeout(() => renameInputRef.current?.select(), 0); }}>
                          <Pencil size={14} />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(project)}>
                          <Trash2 size={14} />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </ContentColumn>
        </PageBody>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.name}?`}
          description="This will permanently delete the project and its documents."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </PageShell>
  );
}
