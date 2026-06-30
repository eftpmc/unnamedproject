import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  ChevronRight, Download, File, FileCode, FileText, Folder,
  Grid2X2, Image, LayoutList, Loader2, Pencil, Search, Trash2, X,
} from 'lucide-react';
import {
  deleteFileById, getFileById, getFileContentUrl, getProjectFiles, updateFileById,
} from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';
import { MARKDOWN_PROSE_CLASS } from '../lib/prose.js';
import { EmptyPanel } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog';
import type { LibraryFile, LibraryFileWithBody } from '../types.js';

// ─── helpers ────────────────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', cs: 'csharp', sh: 'bash', zsh: 'bash',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown',
  html: 'html', css: 'css', sql: 'sql', graphql: 'graphql',
  tex: 'latex', cls: 'latex', sty: 'latex',
};

function extOf(path: string) {
  return (path.split('.').pop()?.toLowerCase()) ?? '';
}

export function detectFileKind(filePath: string): 'image' | 'video' | 'audio' | 'text' {
  const ext = extOf(filePath);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg'].includes(ext)) return 'audio';
  return 'text';
}

function mimeTypeLabel(mimeType: string): string {
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

function isPreviewableBinary(mimeType: string): boolean {
  return mimeType === 'application/pdf' || mimeType.startsWith('image/') || mimeType.startsWith('audio/') || mimeType.startsWith('video/');
}

function fileIcon(path: string, mimeType?: string, size = 14) {
  const ext = extOf(path);
  if (mimeType?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext))
    return <Image size={size} className="shrink-0 text-violet-500" />;
  if (mimeType === 'application/pdf' || ext === 'pdf')
    return <FileText size={size} className="shrink-0 text-red-500" />;
  if (isTextMime(mimeType ?? '') || ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'rb', 'sh', 'zsh', 'json', 'yaml', 'yml', 'toml', 'html', 'css', 'sql', 'md', 'tex', 'cls'].includes(ext))
    return <FileCode size={size} className="shrink-0 text-blue-500" />;
  return <File size={size} className="shrink-0 text-muted-foreground" />;
}

function fileName(file: LibraryFile): string {
  return file.path.split('/').filter(Boolean).pop() ?? file.title;
}

function getFolderContents(files: LibraryFile[], folderPath: string): { folders: string[]; files: LibraryFile[] } {
  const folders = new Set<string>();
  const directFiles: LibraryFile[] = [];
  for (const file of files) {
    if (!file.path.startsWith(folderPath)) continue;
    const rest = file.path.slice(folderPath.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash === -1) directFiles.push(file);
    else folders.add(folderPath + rest.slice(0, slash + 1));
  }
  return {
    folders: [...folders].sort((a, b) => a.localeCompare(b)),
    files: directFiles.sort((a, b) => fileName(a).localeCompare(fileName(b))),
  };
}

function uniqueMimeTypes(files: LibraryFile[]): { mime: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const f of files) {
    if (!seen.has(f.mime_type)) seen.set(f.mime_type, mimeTypeLabel(f.mime_type));
  }
  return [...seen.entries()].map(([mime, label]) => ({ mime, label })).sort((a, b) => a.label.localeCompare(b.label));
}

// ─── preview modal ───────────────────────────────────────────────────────────

function FilePreviewModal({
  file,
  canEdit,
  canDelete,
  onClose,
  onDeleted,
}: {
  file: LibraryFile;
  canEdit?: boolean;
  canDelete?: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, isLoading } = useQuery<LibraryFileWithBody>({
    queryKey: ['library-file', file.id],
    queryFn: () => getFileById(file.id),
  });

  const saveMutation = useMutation({
    mutationFn: (body: string) => updateFileById(file.id, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-file', file.id] });
      qc.invalidateQueries({ queryKey: ['library-files'] });
      qc.invalidateQueries({ queryKey: ['files', file.project_id] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteFileById(file.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-files'] });
      qc.invalidateQueries({ queryKey: ['files', file.project_id], exact: true });
      onDeleted?.();
      onClose();
    },
  });

  const isMd = (EXT_LANG[extOf(file.path)] ?? '') === 'markdown' || file.mime_type === 'text/markdown';
  const isText = isTextMime(file.mime_type);
  const contentUrl = getFileContentUrl(file.id);
  const name = fileName(file);

  function startEdit() {
    setDraftBody(data?.body ?? '');
    setEditing(true);
  }

  return (
    <>
      <DialogPortal>
        <DialogOverlay className="z-50" onClick={onClose} />
        <div className="fixed inset-4 z-50 flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl sm:inset-6">
          <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
            {fileIcon(file.path, file.mime_type, 15)}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{name}</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {file.path}
                {data && <span className="ml-2 not-italic">{mimeTypeLabel(file.mime_type)} · {timeAgo(data.updated_at)}</span>}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canEdit && isText && !editing && data?.body !== null && (
                <Button size="icon-sm" variant="ghost" onClick={startEdit} title="Edit">
                  <Pencil size={13} />
                </Button>
              )}
              <Button size="icon-sm" variant="ghost" asChild title="Download">
                <a href={contentUrl} download={file.title}>
                  <Download size={13} />
                </a>
              </Button>
              {canDelete && !editing && (
                <Button size="icon-sm" variant="ghost" onClick={() => setConfirmDelete(true)} title="Delete" className="text-destructive hover:text-destructive">
                  <Trash2 size={13} />
                </Button>
              )}
              <Button size="icon-sm" variant="ghost" onClick={onClose} title="Close">
                <X size={14} />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1">
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 size={16} className="animate-spin text-muted-foreground/50" />
              </div>
            ) : !data ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Could not load file.</div>
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
            ) : isMd && data.body !== null ? (
              <div className={`h-full overflow-auto px-8 py-6 ${MARKDOWN_PROSE_CLASS}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{data.body}</ReactMarkdown>
              </div>
            ) : isText && data.body !== null ? (
              <div className="h-full overflow-auto">
                <pre className="p-6 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">{data.body}</pre>
              </div>
            ) : isPreviewableBinary(file.mime_type) ? (
              file.mime_type.startsWith('image/') ? (
                <div className="flex h-full items-center justify-center overflow-auto bg-muted/20 p-6">
                  <img src={contentUrl} alt={name} className="max-h-full max-w-full rounded-md object-contain" />
                </div>
              ) : (
                <iframe title={name} src={contentUrl} className="h-full w-full border-0" />
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <p>Preview is not available for this file type.</p>
                <Button size="sm" variant="secondary" asChild>
                  <a href={contentUrl} download={name}>Download</a>
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogPortal>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete file?"
          description="This will permanently delete the file."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

// ─── rows + cards ─────────────────────────────────────────────────────────────

function DirRow({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
    >
      <Folder size={15} className="shrink-0 text-yellow-500" />
      <span className="flex-1 truncate text-sm font-medium text-foreground">{name.replace(/\/$/, '')}</span>
      <ChevronRight size={13} className="shrink-0 text-muted-foreground" />
    </button>
  );
}

function FileRow({ file, onClick }: { file: LibraryFile; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
    >
      {fileIcon(file.path, file.mime_type, 15)}
      <span className="flex-1 truncate text-sm text-foreground">{fileName(file)}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{mimeTypeLabel(file.mime_type)}</span>
      <span className="hidden shrink-0 text-[11px] text-faint-fg sm:block">{timeAgo(file.updated_at)}</span>
    </button>
  );
}

function DirCard({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-xl border border-border-soft bg-muted/30 p-4 text-center transition-colors hover:border-border hover:bg-muted/60"
    >
      <Folder size={28} className="text-yellow-500" />
      <span className="w-full truncate text-xs font-medium text-foreground">{name.replace(/\/$/, '')}</span>
    </button>
  );
}

function FileCard({ file, onClick }: { file: LibraryFile; onClick: () => void }) {
  const name = fileName(file);
  const contentUrl = getFileContentUrl(file.id);
  const isImage = file.mime_type.startsWith('image/');
  return (
    <button type="button" onClick={onClick}
      className="flex flex-col overflow-hidden rounded-xl border border-border-soft bg-background transition-colors hover:border-border hover:shadow-sm"
    >
      <div className="flex h-24 items-center justify-center bg-muted/30">
        {isImage
          ? <img src={contentUrl} alt={name} className="h-full w-full object-cover" />
          : fileIcon(file.path, file.mime_type, 28)}
      </div>
      <div className="flex flex-col gap-0.5 p-2 text-left">
        <span className="truncate text-xs font-medium text-foreground">{name}</span>
        <span className="text-[10px] text-muted-foreground">{mimeTypeLabel(file.mime_type)}</span>
      </div>
    </button>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export interface FileBrowserProps {
  projectId: string;
  projectName?: string;
  files?: LibraryFile[];
  canEdit?: boolean;
  canDelete?: boolean;
}

const ALL_TYPES = '__all__';
type DisplayMode = 'list' | 'grid';
type SortKey = 'name-asc' | 'name-desc' | 'date-desc' | 'date-asc' | 'type';

function sortFiles(files: LibraryFile[], key: SortKey): LibraryFile[] {
  return [...files].sort((a, b) => {
    switch (key) {
      case 'name-desc': return fileName(b).localeCompare(fileName(a));
      case 'date-desc': return b.updated_at - a.updated_at;
      case 'date-asc':  return a.updated_at - b.updated_at;
      case 'type':      return mimeTypeLabel(a.mime_type).localeCompare(mimeTypeLabel(b.mime_type)) || fileName(a).localeCompare(fileName(b));
      default:          return fileName(a).localeCompare(fileName(b));
    }
  });
}

function normalizeFolderPath(path: string): string {
  const normalized = path.split('/').filter(Boolean).join('/');
  return normalized ? `${normalized}/` : '';
}

export default function FileBrowser({ projectId, projectName = 'Files', files: providedFiles, canEdit, canDelete }: FileBrowserProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [previewFile, setPreviewFile] = useState<LibraryFile | null>(null);
  const [search, setSearch] = useState('');
  const [filterMime, setFilterMime] = useState(ALL_TYPES);
  const [sortKey, setSortKey] = useState<SortKey>('name-asc');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('list');
  const dirPath = normalizeFolderPath(searchParams.get('folder') ?? '');

  const { data: fetchedFiles = [], isLoading } = useQuery({
    queryKey: ['files', projectId],
    queryFn: () => getProjectFiles(projectId),
    staleTime: 30_000,
    enabled: !providedFiles,
  });
  const projectFiles = providedFiles ?? fetchedFiles;

  const mimeOptions = useMemo(() => uniqueMimeTypes(projectFiles), [projectFiles]);
  const isSearching = search.trim() !== '' || filterMime !== ALL_TYPES;

  const { folders, files } = useMemo(() => {
    if (isSearching) {
      const q = search.trim().toLowerCase();
      const filtered = projectFiles.filter(f => {
        const nameMatch = !q || fileName(f).toLowerCase().includes(q) || f.path.toLowerCase().includes(q);
        const mimeMatch = filterMime === ALL_TYPES || f.mime_type === filterMime;
        return nameMatch && mimeMatch;
      });
      return { folders: [], files: sortFiles(filtered, sortKey) };
    }
    const { folders: rawFolders, files: rawFiles } = getFolderContents(projectFiles, dirPath);
    return { folders: rawFolders, files: sortFiles(rawFiles, sortKey) };
  }, [projectFiles, dirPath, search, filterMime, sortKey, isSearching]);

  const isEmpty = !isLoading && folders.length === 0 && files.length === 0;
  const breadcrumbs = dirPath ? dirPath.split('/').filter(Boolean) : [];

  function setDirPath(path: string) {
    const next = new URLSearchParams(searchParams);
    const normalized = normalizeFolderPath(path);
    if (normalized) next.set('folder', normalized);
    else next.delete('folder');
    setSearchParams(next, { replace: false });
  }

  function crumbTo(index: number) {
    if (index < 0) { setDirPath(''); return; }
    setDirPath(breadcrumbs.slice(0, index + 1).join('/') + '/');
  }

  return (
    <>
      {/* toolbar */}
      <div className="mb-3 flex flex-col gap-2">
        {/* row 1: search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search files…"
            className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>
        {/* row 2: filters + sort + view */}
        <div className="flex items-center gap-2">
          {mimeOptions.length > 0 && (
            <select
              value={filterMime}
              onChange={e => setFilterMime(e.target.value)}
              className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value={ALL_TYPES}>All types</option>
              {mimeOptions.map(({ mime, label }) => (
                <option key={mime} value={mime}>{label}</option>
              ))}
            </select>
          )}
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="name-asc">Name A–Z</option>
            <option value="name-desc">Name Z–A</option>
            <option value="date-desc">Newest first</option>
            <option value="date-asc">Oldest first</option>
            <option value="type">Type</option>
          </select>
          <div className="ml-auto flex items-center gap-1">
            <Button size="icon-sm" variant={displayMode === 'list' ? 'secondary' : 'ghost'} onClick={() => setDisplayMode('list')} title="List view">
              <LayoutList size={13} />
            </Button>
            <Button size="icon-sm" variant={displayMode === 'grid' ? 'secondary' : 'ghost'} onClick={() => setDisplayMode('grid')} title="Grid view">
              <Grid2X2 size={13} />
            </Button>
          </div>
        </div>
      </div>

      {/* breadcrumb (hidden while searching) */}
      {!isSearching && (
        <div className="mb-3 flex items-center gap-1.5">
          <button type="button" onClick={() => setDirPath('')}
            className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {projectName}
          </button>
          {breadcrumbs.map((seg, i) => (
            <span key={i} className="contents">
              <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
              <button type="button" onClick={() => crumbTo(i)}
                className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground last:pointer-events-none last:text-foreground"
              >
                {seg}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* file list / grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={16} className="animate-spin text-muted-foreground/50" />
        </div>
      ) : isEmpty ? (
        <div className="rounded-lg border border-border-soft bg-card p-4">
          <EmptyPanel
            title={isSearching ? 'No matching files' : 'No files yet'}
            description={isSearching ? 'Try a different search term or filter.' : 'Files will appear here once the agent writes to this project.'}
          />
        </div>
      ) : displayMode === 'list' ? (
        <div className="overflow-hidden rounded-lg border border-border-soft bg-card">
          <div className="divide-y divide-border-soft">
            {folders.map(folder => (
              <DirRow key={folder} name={folder.slice(dirPath.length)} onClick={() => setDirPath(folder)} />
            ))}
            {files.map(file => (
              <FileRow key={file.id} file={file} onClick={() => setPreviewFile(file)} />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {folders.map(folder => (
            <DirCard key={folder} name={folder.slice(dirPath.length)} onClick={() => setDirPath(folder)} />
          ))}
          {files.map(file => (
            <FileCard key={file.id} file={file} onClick={() => setPreviewFile(file)} />
          ))}
        </div>
      )}

      {/* preview modal */}
      <Dialog open={!!previewFile} onOpenChange={open => { if (!open) setPreviewFile(null); }}>
        {previewFile && (
          <FilePreviewModal
            file={previewFile}
            canEdit={canEdit}
            canDelete={canDelete}
            onClose={() => setPreviewFile(null)}
            onDeleted={() => setPreviewFile(null)}
          />
        )}
      </Dialog>
    </>
  );
}
