import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronRight, Download, File, FileCode, FileText, Folder, Image, Loader2, X } from 'lucide-react';
import { getFileById, getFileContentUrl, getProjectFiles } from '../lib/api.js';
import { EmptyPanel } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog';
import type { LibraryFile } from '../types.js';

// ─── helpers ────────────────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', cs: 'csharp', sh: 'bash', zsh: 'bash',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown',
  html: 'html', css: 'css', sql: 'sql', graphql: 'graphql',
  tex: 'latex', cls: 'latex', sty: 'latex',
};

const EXT_LABEL: Record<string, string> = {
  ts: 'TS', tsx: 'TSX', js: 'JS', jsx: 'JSX',
  py: 'PY', go: 'GO', rs: 'RS', rb: 'RB',
  md: 'MD', json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
  html: 'HTML', css: 'CSS', sql: 'SQL',
  tex: 'TEX', cls: 'CLS',
  txt: 'TXT', sh: 'SH', zsh: 'SH',
  pdf: 'PDF', png: 'PNG', jpg: 'JPG', jpeg: 'JPG', gif: 'GIF', svg: 'SVG', webp: 'WEBP',
  ttf: 'TTF', woff: 'WOFF', woff2: 'WOFF2',
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

function fileLabel(path: string): string {
  return EXT_LABEL[extOf(path)] ?? (extOf(path).toUpperCase() || 'FILE');
}

function isTextMime(mimeType: string): boolean {
  return mimeType.startsWith('text/') || ['application/json', 'application/xml', 'application/yaml'].includes(mimeType);
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
  const prefix = folderPath;
  const folders = new Set<string>();
  const directFiles: LibraryFile[] = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash === -1) directFiles.push(file);
    else folders.add(prefix + rest.slice(0, slash + 1));
  }
  return {
    folders: [...folders].sort((a, b) => a.localeCompare(b)),
    files: directFiles.sort((a, b) => fileName(a).localeCompare(fileName(b))),
  };
}

// ─── file preview modal ──────────────────────────────────────────────────────

function FilePreviewModal({
  file,
  onClose,
}: {
  file: LibraryFile;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['library-file', file.id],
    queryFn: () => getFileById(file.id),
    staleTime: 10_000,
  });

  const lang = EXT_LANG[extOf(file.path)] ?? 'text';
  const isMd = lang === 'markdown';
  const contentUrl = getFileContentUrl(file.id);
  const name = fileName(file);

  return (
    <DialogPortal>
      <DialogOverlay className="z-50" onClick={onClose} />
      <div className="fixed inset-4 z-50 flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl sm:inset-6">
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          {fileIcon(file.path, file.mime_type, 15)}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{name}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{file.path}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="icon-sm" variant="ghost" asChild title="Download">
              <a href={contentUrl} download={name}>
                <Download size={14} />
              </a>
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={onClose} title="Close">
              <X size={14} />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 size={16} className="animate-spin text-muted-foreground/50" />
            </div>
          ) : !data ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Could not load file.</div>
          ) : data.body !== null && isMd ? (
            <div className="h-full overflow-auto px-8 py-6 text-[14px] leading-relaxed text-fg-soft [&_a]:text-primary [&_a]:underline-offset-2 [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_h1:first-child]:mt-0 [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground [&_hr]:my-5 [&_hr]:border-border-soft [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:ml-5 [&_ol]:list-decimal [&_p:last-child]:mb-0 [&_p]:mb-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border-soft [&_pre]:bg-muted/30 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12px] [&_ul]:mb-3 [&_ul]:ml-5 [&_ul]:list-disc">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.body}</ReactMarkdown>
            </div>
          ) : data.body !== null ? (
            <div className="h-full overflow-auto">
              <pre className="p-6 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
                {data.body}
              </pre>
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
  );
}

// ─── rows ────────────────────────────────────────────────────────────────────

function DirRow({ name, onClick }: { name: string; onClick: () => void }) {
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

function FileRow({ file, onClick }: { file: LibraryFile; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
    >
      {fileIcon(file.path, file.mime_type, 15)}
      <span className="flex-1 truncate text-sm text-foreground">{fileName(file)}</span>
      <span className="shrink-0 text-[11px] text-faint-fg">{fileLabel(file.path)}</span>
    </button>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export interface FileBrowserProps {
  projectId: string;
  projectName?: string;
}

export default function FileBrowser({ projectId, projectName = 'Repository' }: FileBrowserProps) {
  const [dirPath, setDirPath] = useState('');
  const [previewFile, setPreviewFile] = useState<LibraryFile | null>(null);

  const { data: projectFiles = [], isLoading } = useQuery({
    queryKey: ['files', projectId],
    queryFn: () => getProjectFiles(projectId),
    staleTime: 30_000,
  });

  const { folders, files } = getFolderContents(projectFiles, dirPath);
  const isEmpty = !isLoading && folders.length === 0 && files.length === 0;

  const breadcrumbs = dirPath ? dirPath.split('/').filter(Boolean) : [];

  function navigateTo(path: string) {
    setDirPath(path);
  }

  function crumbTo(index: number) {
    if (index < 0) { setDirPath(''); return; }
    setDirPath(breadcrumbs.slice(0, index + 1).join('/') + '/');
  }

  return (
    <>
      {/* breadcrumb */}
      <div className="mb-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setDirPath('')}
          className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {projectName}
        </button>
        {breadcrumbs.map((seg, i) => (
          <span key={i} className="contents">
            <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
            <button
              type="button"
              onClick={() => crumbTo(i)}
              className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground last:pointer-events-none last:text-foreground"
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {/* list */}
      <div className="overflow-hidden rounded-lg border border-border-soft bg-card">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={16} className="animate-spin text-muted-foreground/50" />
          </div>
        ) : isEmpty ? (
          <div className="p-4">
            <EmptyPanel title="No files yet" description="Files will appear here once the agent writes to this project." />
          </div>
        ) : (
          <div className="divide-y divide-border-soft">
            {folders.map(folder => (
              <DirRow key={folder} name={folder.slice(dirPath.length)} onClick={() => navigateTo(folder)} />
            ))}
            {files.map(file => (
              <FileRow key={file.id} file={file} onClick={() => setPreviewFile(file)} />
            ))}
          </div>
        )}
      </div>

      {/* preview modal */}
      <Dialog open={!!previewFile} onOpenChange={open => { if (!open) setPreviewFile(null); }}>
        {previewFile && (
          <FilePreviewModal
            file={previewFile}
            onClose={() => setPreviewFile(null)}
          />
        )}
      </Dialog>
    </>
  );
}
