import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clipboard, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { getAllDocuments, updateDocumentById, deleteDocumentById, createGlobalDocument, getProjects } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { timeAgo } from '../lib/utils.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CenteredEmptyState, ContentColumn, EmptyPanel, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import { DataTable, DataTableBody, DataTableHeader, DataTableRow } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FilterStrip } from '@/components/ui/filter-strip';
import type { Document, Project } from '../types.js';

function documentKind(doc: Document): string {
  if (doc.type) return doc.type;
  if (doc.path.endsWith('.md') || doc.path.endsWith('.mdx')) return 'Markdown';
  return 'Document';
}

export default function DocumentsPage() {
  usePageTitle('Documents');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newProjectId, setNewProjectId] = useState('');

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ['documents-global'],
    queryFn: () => getAllDocuments(),
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: ({ title, spaceId }: { title: string; spaceId: string }) =>
      createGlobalDocument({ title, space_id: spaceId }),
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: ['documents-global'] });
      setCreateOpen(false);
      setNewTitle('');
      setNewProjectId('');
      navigate(`/documents/${doc.id}`);
    },
  });

  function openCreateDialog() {
    setNewTitle('');
    setNewProjectId(projects[0]?.id ?? '');
    setCreateOpen(true);
  }

  function submitCreate() {
    const title = newTitle.trim();
    const project = projects.find(p => p.id === newProjectId);
    if (!title || !project) return;
    createMutation.mutate({ title, spaceId: project.space_id! });
  }

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => updateDocumentById(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents-global'] });
      setRenaming(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocumentById(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents-global'] });
      setPendingDelete(null);
    },
    onError: () => setPendingDelete(null),
  });

  const filters = [
    { value: 'all', label: 'All' },
    ...Array.from(new Set(documents.map(documentKind)))
      .sort((a, b) => a.localeCompare(b))
      .map(kind => ({ value: kind, label: kind })),
  ];
  const visible = documents.filter(doc => {
    const query = search.trim().toLowerCase();
    const kind = documentKind(doc);
    if (filter !== 'all' && kind !== filter) return false;
    if (!query) return true;
    return doc.title.toLowerCase().includes(query)
      || doc.path.toLowerCase().includes(query)
      || kind.toLowerCase().includes(query);
  });

  function copyPath(path: string) {
    void navigator.clipboard?.writeText(path);
  }

  function startRename(doc: Document) {
    setRenaming({ id: doc.id, value: doc.title });
    setTimeout(() => renameInputRef.current?.select(), 0);
  }

  function commitRename() {
    if (!renaming) return;
    const trimmed = renaming.value.trim();
    if (!trimmed) { setRenaming(null); return; }
    const original = documents.find(d => d.id === renaming.id)?.title;
    if (trimmed === original) { setRenaming(null); return; }
    renameMutation.mutate({ id: renaming.id, title: trimmed });
  }

  return (
    <PageShell>
      <PageHeader
        title="Documents"
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
        actions={
          <Button
            size="lg"
            className="h-9 gap-2 rounded-lg px-3 text-sm shadow-sm"
            onClick={openCreateDialog}
            disabled={projects.length === 0}
            title={projects.length === 0 ? 'Create a project first' : 'New document'}
          >
            <Plus size={16} />New document
          </Button>
        }
      />

      {isLoading ? <PageLoading rows={4} /> : documents.length === 0 ? (
        <CenteredEmptyState
          title="No documents yet"
          description="Documents created by the agent will appear here."
        />
      ) : (
        <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
          <ContentColumn className="max-w-7xl">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative min-w-0 flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint-fg pointer-events-none" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search documents…"
                  className="pl-8"
                />
              </div>
              <FilterStrip value={filter} items={filters} onValueChange={setFilter} />
            </div>
            {visible.length === 0 ? (
              <EmptyPanel title="No results" description={`Nothing matched "${search || filter}".`} />
            ) : (
              <DataTable>
                <DataTableHeader className="grid-cols-[minmax(0,1fr)_1.75rem] sm:grid-cols-[minmax(0,1fr)_8rem_6rem_1.75rem]">
                  <span>Title</span>
                  <span className="hidden sm:block">Type</span>
                  <span className="hidden justify-self-end sm:block">Updated</span>
                  <span />
                </DataTableHeader>
                <DataTableBody>
                  {visible.map(doc => (
                    <DataTableRow
                      key={doc.id}
                      className="grid-cols-[minmax(0,1fr)_1.75rem] sm:grid-cols-[minmax(0,1fr)_8rem_6rem_1.75rem]"
                    >
                      <div className="min-w-0">
                        {renaming?.id === doc.id ? (
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
                            <Link to={`/documents/${doc.id}`} className="block truncate text-sm font-medium text-foreground underline-offset-2 hover:underline">
                              {doc.title}
                            </Link>
                            <div className="mt-0.5 flex gap-2 text-[11px] text-faint-fg sm:hidden">
                              <span className="truncate">{documentKind(doc)}</span>
                              <span className="shrink-0">·</span>
                              <span className="shrink-0">{timeAgo(doc.updated_at)}</span>
                            </div>
                          </>
                        )}
                      </div>
                      <span className="hidden truncate text-xs text-muted-foreground sm:block">{documentKind(doc)}</span>
                      <span className="hidden justify-self-end whitespace-nowrap text-[11px] text-faint-fg sm:block">{timeAgo(doc.updated_at)}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Options for ${doc.title}`}
                            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onSelect={() => startRename(doc)}>
                            <Pencil size={14} />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => copyPath(doc.path)}>
                            <Clipboard size={14} />
                            Copy path
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(doc.id)}>
                            <Trash2 size={14} />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            )}
          </ContentColumn>
        </PageBody>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete document?"
          description="This will permanently delete the document. This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Title</span>
              <Input
                autoFocus
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Untitled document"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitCreate(); } }}
              />
            </label>
            {projects.length > 1 && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Project</span>
                <select
                  value={newProjectId}
                  onChange={e => setNewProjectId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={submitCreate}
              disabled={!newTitle.trim() || !newProjectId || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
