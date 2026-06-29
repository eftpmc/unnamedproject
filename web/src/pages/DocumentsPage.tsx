import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clipboard, Download, MoreHorizontal, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { getAllDocuments, updateDocumentById, deleteDocumentById, createGlobalDocument, uploadDocumentFile, getProjects } from '../lib/api.js';
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

type DocCategory = 'all' | 'text' | 'pdf' | 'image' | 'other';

function docCategory(doc: Document): DocCategory {
  const m = doc.mime_type || 'text/markdown';
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/xml' || m === 'application/yaml') return 'text';
  return 'other';
}

function docKindLabel(doc: Document): string {
  if (doc.type) return doc.type;
  const m = doc.mime_type || 'text/markdown';
  if (m === 'text/markdown') return 'Markdown';
  if (m === 'text/plain') return 'Text';
  if (m === 'application/pdf') return 'PDF';
  if (m.startsWith('image/')) {
    const sub = m.split('/')[1]?.toUpperCase() || 'Image';
    return sub === 'JPEG' ? 'JPG' : sub;
  }
  if (m === 'application/json') return 'JSON';
  if (m.includes('yaml')) return 'YAML';
  if (m.startsWith('text/')) return 'Text';
  return m.split('/')[1]?.toUpperCase() || 'File';
}

function isBinary(doc: Document): boolean {
  const m = doc.mime_type || 'text/markdown';
  return !m.startsWith('text/') && m !== 'application/json' && m !== 'application/xml' && m !== 'application/yaml';
}

export default function DocumentsPage() {
  usePageTitle('Documents');
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<DocCategory>('all');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newProjectId, setNewProjectId] = useState('');
  const [uploadProjectId, setUploadProjectId] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ['documents-global'],
    queryFn: () => getAllDocuments(),
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => getProjects(),
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: ({ title, projectId }: { title: string; projectId: string }) =>
      createGlobalDocument({ title, project_id: projectId }),
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: ['documents-global'] });
      setCreateOpen(false);
      setNewTitle('');
      setNewProjectId('');
      navigate(`/documents/${doc.id}`);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: ({ file, projectId }: { file: File; projectId: string }) =>
      uploadDocumentFile(file, projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents-global'] });
      setUploadOpen(false);
    },
  });

  function openCreateDialog() {
    setNewTitle('');
    setNewProjectId(projects[0]?.id ?? '');
    setCreateOpen(true);
  }

  function openUploadDialog() {
    setUploadProjectId(projects[0]?.id ?? '');
    setUploadOpen(true);
  }

  useEffect(() => {
    if ((location.state as { openNew?: boolean } | null)?.openNew && projects.length > 0) {
      openCreateDialog();
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, projects.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function submitCreate() {
    const title = newTitle.trim();
    const project = projects.find(p => p.id === newProjectId);
    if (!title || !project) return;
    createMutation.mutate({ title, projectId: project.id });
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadProjectId) return;
    uploadMutation.mutate({ file, projectId: uploadProjectId });
    e.target.value = '';
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

  const filterItems = [
    { value: 'all', label: 'All' },
    { value: 'text', label: 'Text' },
    { value: 'pdf', label: 'PDF' },
    { value: 'image', label: 'Images' },
    { value: 'other', label: 'Other' },
  ];

  const visible = documents.filter(doc => {
    const query = search.trim().toLowerCase();
    if (filter !== 'all' && docCategory(doc) !== filter) return false;
    if (!query) return true;
    return doc.title.toLowerCase().includes(query)
      || doc.path.toLowerCase().includes(query)
      || docKindLabel(doc).toLowerCase().includes(query);
  });

  function copyPath(p: string) {
    void navigator.clipboard?.writeText(p);
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
          <div className="flex items-center gap-2">
            <Button
              size="lg"
              variant="outline"
              className="h-9 gap-2 rounded-lg px-3 text-sm shadow-sm"
              onClick={openUploadDialog}
              disabled={projects.length === 0}
              title={projects.length === 0 ? 'Create a project first' : 'Upload file'}
            >
              <Upload size={15} />Upload
            </Button>
            <Button
              size="lg"
              className="h-9 gap-2 rounded-lg px-3 text-sm shadow-sm"
              onClick={openCreateDialog}
              disabled={projects.length === 0}
              title={projects.length === 0 ? 'Create a project first' : 'New document'}
            >
              <Plus size={16} />New
            </Button>
          </div>
        }
      />

      {isLoading ? <PageLoading rows={4} /> : documents.length === 0 ? (
        <CenteredEmptyState
          title="No documents yet"
          description="Documents created or uploaded to a project will appear here."
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
              <FilterStrip value={filter} items={filterItems} onValueChange={v => setFilter(v as DocCategory)} />
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
                            {isBinary(doc) ? (
                              <a
                                href={`/documents/${doc.id}/content`}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate text-sm font-medium text-foreground underline-offset-2 hover:underline"
                              >
                                {doc.title}
                              </a>
                            ) : (
                              <Link
                                to={`/documents/${doc.id}`}
                                className="block truncate text-sm font-medium text-foreground underline-offset-2 hover:underline"
                              >
                                {doc.title}
                              </Link>
                            )}
                            <div className="mt-0.5 flex gap-2 text-[11px] text-faint-fg sm:hidden">
                              <span className="truncate">{docKindLabel(doc)}</span>
                              <span className="shrink-0">·</span>
                              <span className="shrink-0">{timeAgo(doc.updated_at)}</span>
                            </div>
                          </>
                        )}
                      </div>
                      <span className="hidden truncate text-xs text-muted-foreground sm:block">{docKindLabel(doc)}</span>
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
                          {!isBinary(doc) && (
                            <DropdownMenuItem onSelect={() => startRename(doc)}>
                              <Pencil size={14} />
                              Rename
                            </DropdownMenuItem>
                          )}
                          {isBinary(doc) && (
                            <DropdownMenuItem onSelect={() => startRename(doc)}>
                              <Pencil size={14} />
                              Rename
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => copyPath(doc.path)}>
                            <Clipboard size={14} />
                            Copy path
                          </DropdownMenuItem>
                          {isBinary(doc) && (
                            <DropdownMenuItem asChild>
                              <a href={`/documents/${doc.id}/content`} download={doc.title}>
                                <Download size={14} />
                                Download
                              </a>
                            </DropdownMenuItem>
                          )}
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
          description="This will permanently delete the file. This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {/* New text document dialog */}
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

      {/* Upload file dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload file</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {projects.length > 1 && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Project</span>
                <select
                  value={uploadProjectId}
                  onChange={e => setUploadProjectId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            )}
            <div
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-center transition-colors hover:border-ring"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={20} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {uploadMutation.isPending ? 'Uploading…' : 'Click to choose a file'}
              </p>
              <p className="text-[11px] text-faint-fg">PDF, images, text files — up to 50 MB</p>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileSelected}
                disabled={!uploadProjectId || uploadMutation.isPending}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUploadOpen(false)} disabled={uploadMutation.isPending}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
