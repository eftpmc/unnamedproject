import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  ChevronRight, Download, File, FileCode, FileText, Folder,
  Grid2X2, Image, LayoutList, Pencil, Trash2, X,
} from 'lucide-react';
import {
  getAllFiles, getFileById, getFileContentUrl,
  deleteFileById, updateFileById, getProjects,
} from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { timeAgo } from '../lib/utils.js';
import { Button } from '@/components/ui/button';
import {
  CenteredEmptyState, ContentColumn, EmptyPanel,
  PageBody, PageHeader, PageLoading, PageShell,
} from '@/components/ui/app-layout';
import { DataTable, DataTableBody, DataTableHeader, DataTableRow } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogPortal, DialogOverlay } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { LibraryFile, LibraryFileWithBody, Project } from '../types.js';

// ─── helpers ────────────────────────────────────────────────────────────────

const PROSE = 'text-[14px] leading-relaxed text-fg-soft [&_a]:text-primary [&_a]:underline-offset-2 [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_h1:first-child]:mt-0 [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground [&_hr]:my-5 [&_hr]:border-border-soft [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:ml-5 [&_ol]:list-decimal [&_p:last-child]:mb-0 [&_p]:mb-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border-soft [&_pre]:bg-muted/30 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12px] [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border-soft [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border-soft [&_th]:bg-muted/30 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:mb-3 [&_ul]:ml-5 [&_ul]:list-disc';

function mimeIcon(mimeType: string, size = 14) {
  if (mimeType.startsWith('image/')) return <Image size={size} className="shrink-0 text-violet-500" />;
  if (mimeType === 'application/pdf') return <FileText size={size} className="shrink-0 text-red-500" />;
  if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('yaml'))
    return <FileCode size={size} className="shrink-0 text-blue-500" />;
  return <File size={size} className="shrink-0 text-muted-foreground" />;
}

function mimeLabel(mimeType: string): string {
  if (mimeType === 'text/markdown') return 'MD';
  if (mimeType === 'text/plain') return 'TXT';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType === 'application/json') return 'JSON';
  if (mimeType.includes('yaml')) return 'YAML';
  if (mimeType.startsWith('image/')) return mimeType.split('/')[1]?.toUpperCase().replace('JPEG', 'JPG') ?? 'IMG';
  if (mimeType.startsWith('text/')) return mimeType.split('/')[1]?.toUpperCase() ?? 'TXT';
  return mimeType.split('/')[1]?.toUpperCase() ?? 'FILE';
}

function isTextMime(mimeType: string): boolean {
  return mimeType.startsWith('text/') || ['application/json', 'application/xml', 'application/yaml', 'application/x-yaml'].includes(mimeType);
}

interface FolderContents { folders: string[]; files: LibraryFile[] }

function getFolderContents(docs: LibraryFile[], prefix: string): FolderContents {
  const folders = new Set<string>();
  const files: LibraryFile[] = [];
  for (const doc of docs) {
    if (!doc.path.startsWith(prefix)) continue;
    const rest = doc.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) files.push(doc);
    else folders.add(prefix + rest.slice(0, slash + 1));
  }
  return { folders: [...folders].sort(), files: files.sort((a, b) => a.title.localeCompare(b.title)) };
}

// ─── preview modal ───────────────────────────────────────────────────────────

function PreviewContent({ doc }: { doc: LibraryFileWithBody }) {
  const contentUrl = getFileContentUrl(doc.id);
  const mime = doc.mime_type;

  if (mime.startsWith('image/')) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-6">
        <img src={contentUrl} alt={doc.title} className="max-h-full max-w-full rounded object-contain" />
      </div>
    );
  }

  if (mime === 'application/pdf') {
    return <iframe src={contentUrl} title={doc.title} className="h-full w-full border-0" />;
  }

  if (mime === 'text/markdown' && doc.body !== null) {
    return (
      <div className="h-full overflow-auto px-8 py-6">
        <div className={PROSE}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {doc.body}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  if (isTextMime(mime) && doc.body !== null) {
    return (
      <div className="h-full overflow-auto p-6">
        <pre className="font-mono text-[13px] text-muted-foreground whitespace-pre-wrap break-words">{doc.body}</pre>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      {mimeIcon(mime, 32)}
      <p className="text-sm text-muted-foreground">Preview not available for this file type.</p>
      <a
        href={contentUrl}
        download={doc.title}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Download size={14} />
        Download
      </a>
    </div>
  );
}

function FilePreviewModal({
  docId,
  onClose,
  onDeleted,
}: {
  docId: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: doc, isLoading } = useQuery<LibraryFileWithBody>({
    queryKey: ['library-file', docId],
    queryFn: () => getFileById(docId),
  });

  const saveMutation = useMutation({
    mutationFn: (body: string) => updateFileById(docId, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-file', docId] });
      qc.invalidateQueries({ queryKey: ['library-files'] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteFileById(docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-files'] });
      onDeleted();
    },
  });

  function startEdit() {
    setDraftBody(doc?.body ?? '');
    setEditing(true);
  }

  const isText = doc ? isTextMime(doc.mime_type) : false;
  const contentUrl = doc ? getFileContentUrl(doc.id) : '';

  return (
    <>
      <DialogPortal>
        <DialogOverlay className="z-50" onClick={onClose} />
        <div className="fixed inset-4 z-50 flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl sm:inset-6">
          <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
            {doc && mimeIcon(doc.mime_type, 15)}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{doc?.title ?? '…'}</p>
              {doc && (
                <p className="text-[11px] text-muted-foreground">
                  {mimeLabel(doc.mime_type)} · {timeAgo(doc.updated_at)}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {doc && isText && !editing && (
                <Button size="icon-sm" variant="ghost" onClick={startEdit} title="Edit">
                  <Pencil size={13} />
                </Button>
              )}
              {doc && (
                <Button size="icon-sm" variant="ghost" title="Download" onClick={() => {
                  const a = document.createElement('a');
                  a.href = contentUrl;
                  a.download = doc.title;
                  a.click();
                }}>
                  <Download size={13} />
                </Button>
              )}
              {doc && (
                <Button size="icon-sm" variant="ghost" onClick={() => setConfirmDelete(true)} title="Delete" className="text-destructive hover:text-destructive">
                  <Trash2 size={13} />
                </Button>
              )}
              <Button size="icon-sm" variant="ghost" onClick={onClose} title="Close">
                <X size={14} />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
            ) : !doc ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Not found.</div>
            ) : editing ? (
              <div className="flex h-full flex-col">
                <textarea
                  className="flex-1 resize-none bg-background p-6 font-mono text-[13px] text-foreground outline-none"
                  value={draftBody}
                  onChange={e => setDraftBody(e.target.value)}
                  autoFocus
                />
                <div className="flex justify-end gap-2 border-t px-4 py-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saveMutation.isPending}>Cancel</Button>
                  <Button size="sm" onClick={() => saveMutation.mutate(draftBody)} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            ) : (
              <PreviewContent doc={doc} />
            )}
          </div>
        </div>
      </DialogPortal>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete file?"
          description="This will permanently delete the file from the library."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

// ─── file browser ────────────────────────────────────────────────────────────

type DisplayMode = 'list' | 'grid';

function FolderRow({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
    >
      <Folder size={15} className="shrink-0 text-yellow-500" />
      <span className="flex-1 truncate text-sm font-medium text-foreground">{name.replace(/\/$/, '')}</span>
      <ChevronRight size={13} className="shrink-0 text-muted-foreground" />
    </button>
  );
}

function FileRow({ doc, onClick }: { doc: LibraryFile; onClick: () => void }) {
  const name = doc.path.split('/').pop() ?? doc.title;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
    >
      {mimeIcon(doc.mime_type, 15)}
      <span className="flex-1 truncate text-sm text-foreground">{name}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{mimeLabel(doc.mime_type)}</span>
      <span className="hidden shrink-0 text-[11px] text-faint-fg sm:block">{timeAgo(doc.updated_at)}</span>
    </button>
  );
}

function FolderCard({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-xl border border-border-soft bg-muted/30 p-4 text-center transition-colors hover:border-border hover:bg-muted/60"
    >
      <Folder size={28} className="text-yellow-500" />
      <span className="w-full truncate text-xs font-medium text-foreground">{name.replace(/\/$/, '')}</span>
    </button>
  );
}

function FileCard({ doc, onClick }: { doc: LibraryFile; onClick: () => void }) {
  const name = doc.path.split('/').pop() ?? doc.title;
  const contentUrl = getFileContentUrl(doc.id);
  const isImage = doc.mime_type.startsWith('image/');

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col overflow-hidden rounded-xl border border-border-soft bg-background transition-colors hover:border-border hover:shadow-sm"
    >
      <div className="flex h-24 items-center justify-center bg-muted/30">
        {isImage ? (
          <img src={contentUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          mimeIcon(doc.mime_type, 28)
        )}
      </div>
      <div className="flex flex-col gap-0.5 p-2 text-left">
        <span className="truncate text-xs font-medium text-foreground">{name}</span>
        <span className="text-[10px] text-muted-foreground">{mimeLabel(doc.mime_type)}</span>
      </div>
    </button>
  );
}

function FileBrowser({
  project,
  docs,
  folderPath,
  onNavigateFolder,
  onBack,
  onPreview,
}: {
  project: Project;
  docs: LibraryFile[];
  folderPath: string;
  onNavigateFolder: (path: string) => void;
  onBack: () => void;
  onPreview: (id: string) => void;
}) {
  const [displayMode, setDisplayMode] = useState<DisplayMode>('list');

  const { folders, files } = getFolderContents(docs, folderPath);
  const isEmpty = folders.length === 0 && files.length === 0;
  const breadcrumbs = folderPath ? folderPath.split('/').filter(Boolean) : [];

  function crumbTo(index: number) {
    if (index < 0) { onNavigateFolder(''); return; }
    onNavigateFolder(breadcrumbs.slice(0, index + 1).join('/') + '/');
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-1.5">
        <button
          type="button"
          onClick={folderPath ? () => crumbTo(-1) : onBack}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Library
        </button>
        <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
        <button
          type="button"
          onClick={() => { if (folderPath) onNavigateFolder(''); }}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {project.name}
        </button>
        {breadcrumbs.map((seg, i) => (
          <span key={i} className="contents">
            <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
            <button
              type="button"
              onClick={() => crumbTo(i)}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors last:text-foreground last:pointer-events-none"
            >
              {seg}
            </button>
          </span>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="icon-sm"
            variant={displayMode === 'list' ? 'secondary' : 'ghost'}
            onClick={() => setDisplayMode('list')}
            title="List view"
          >
            <LayoutList size={13} />
          </Button>
          <Button
            size="icon-sm"
            variant={displayMode === 'grid' ? 'secondary' : 'ghost'}
            onClick={() => setDisplayMode('grid')}
            title="Grid view"
          >
            <Grid2X2 size={13} />
          </Button>
        </div>
      </div>

      {isEmpty ? (
        <EmptyPanel title="Empty folder" description="No files here yet." />
      ) : displayMode === 'list' ? (
        <div className="overflow-hidden rounded-lg border border-border-soft bg-card">
          <div className="divide-y divide-border-soft">
            {folders.map(f => (
              <FolderRow key={f} name={f.slice(folderPath.length)} onClick={() => onNavigateFolder(f)} />
            ))}
            {files.map(doc => (
              <FileRow key={doc.id} doc={doc} onClick={() => onPreview(doc.id)} />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {folders.map(f => (
            <FolderCard key={f} name={f.slice(folderPath.length)} onClick={() => onNavigateFolder(f)} />
          ))}
          {files.map(doc => (
            <FileCard key={doc.id} doc={doc} onClick={() => onPreview(doc.id)} />
          ))}
        </div>
      )}
    </>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  usePageTitle('Library');
  const [searchParams, setSearchParams] = useSearchParams();
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);

  const selectedProjectId = searchParams.get('p');
  const folderPath = searchParams.get('f') ?? '';

  const { data: documents = [], isLoading: docsLoading } = useQuery<LibraryFile[]>({
    queryKey: ['library-files'],
    queryFn: () => getAllFiles(),
  });

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => getProjects(),
    staleTime: 60_000,
  });

  const isLoading = docsLoading || projectsLoading;
  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;
  const projectDocs = selectedProject
    ? documents.filter(d => d.project_id === selectedProject.id)
    : [];

  function selectProject(id: string) {
    setSearchParams({ p: id }, { replace: false });
  }

  function goBack() {
    setSearchParams({}, { replace: false });
  }

  function navigateFolder(path: string) {
    const next = new URLSearchParams(searchParams);
    if (path) next.set('f', path);
    else next.delete('f');
    setSearchParams(next, { replace: false });
  }

  return (
    <PageShell>
      <PageHeader
        title={selectedProject ? selectedProject.name : 'Library'}
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
      />

      {isLoading ? (
        <PageLoading rows={4} />
      ) : !selectedProject ? (
        projects.length === 0 ? (
          <CenteredEmptyState
            title="No projects yet"
            description="Create a project to start building your library."
          />
        ) : (
          <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
            <ContentColumn className="max-w-7xl">
              <DataTable>
                <DataTableHeader className="grid-cols-[minmax(0,1fr)_5rem]">
                  <span>Project</span>
                  <span className="justify-self-end">Files</span>
                </DataTableHeader>
                <DataTableBody>
                  {projects.map(project => {
                    const count = documents.filter(d => d.project_id === project.id).length;
                    return (
                      <DataTableRow key={project.id} className="grid-cols-[minmax(0,1fr)_5rem]">
                        <div className="flex min-w-0 items-center gap-3">
                          <Folder size={14} className="shrink-0 text-muted-foreground" />
                          <button
                            type="button"
                            onClick={() => selectProject(project.id)}
                            className="min-w-0 truncate text-left text-sm font-medium text-foreground underline-offset-2 hover:underline"
                          >
                            {project.name}
                          </button>
                        </div>
                        <span className="justify-self-end text-xs text-faint-fg">
                          {count} {count === 1 ? 'file' : 'files'}
                        </span>
                      </DataTableRow>
                    );
                  })}
                </DataTableBody>
              </DataTable>
            </ContentColumn>
          </PageBody>
        )
      ) : (
        <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
          <ContentColumn className="max-w-7xl">
            <FileBrowser
              project={selectedProject}
              docs={projectDocs}
              folderPath={folderPath}
              onNavigateFolder={navigateFolder}
              onBack={goBack}
              onPreview={id => setPreviewDocId(id)}
            />
          </ContentColumn>
        </PageBody>
      )}

      <Dialog open={!!previewDocId} onOpenChange={open => { if (!open) setPreviewDocId(null); }}>
        {previewDocId && (
          <FilePreviewModal
            docId={previewDocId}
            onClose={() => setPreviewDocId(null)}
            onDeleted={() => setPreviewDocId(null)}
          />
        )}
      </Dialog>
    </PageShell>
  );
}
