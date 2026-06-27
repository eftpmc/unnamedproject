import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen, Loader2 } from 'lucide-react';
import { getProjectTree, getProjectFile } from '../lib/api.js';
import { cn } from '@/lib/utils';
import { EmptyPanel, Surface } from '@/components/ui/app-layout';
import type { FileEntry } from '../types.js';

interface FileBrowserProps {
  spaceId: string;
  projectId: string;
  projectName?: string;
}

interface TreeNodeProps {
  entry: FileEntry;
  spaceId: string;
  projectId: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function TreeNode({ entry, spaceId, projectId, depth, selectedPath, onSelect }: TreeNodeProps) {
  const [open, setOpen] = useState(false);
  const { data, isFetching } = useQuery({
    queryKey: ['project-tree', spaceId, projectId, entry.path],
    queryFn: () => getProjectTree(spaceId, projectId, entry.path),
    enabled: entry.type === 'dir' && open,
    staleTime: 30000,
  });

  if (entry.type === 'file') {
    return (
      <button
        onClick={() => onSelect(entry.path)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50',
          selectedPath === entry.path && 'bg-muted text-foreground font-medium',
          selectedPath !== entry.path && 'text-muted-foreground',
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <FileText size={15} className="shrink-0 opacity-65" />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {isFetching
          ? <Loader2 size={13} className="shrink-0 animate-spin opacity-60" />
          : open
            ? <ChevronDown size={13} className="shrink-0 opacity-60" />
            : <ChevronRight size={13} className="shrink-0 opacity-60" />
        }
        {open ? <FolderOpen size={15} className="shrink-0 text-on-accent-soft" /> : <Folder size={15} className="shrink-0 text-on-accent-soft" />}
        <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
      </button>
      {open && data?.entries.map(child => (
        <TreeNode
          key={child.path}
          entry={child}
          spaceId={spaceId}
          projectId={projectId}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    c: 'c', cpp: 'cpp', cs: 'csharp', sh: 'bash', zsh: 'bash',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown',
    html: 'html', css: 'css', sql: 'sql', graphql: 'graphql',
  };
  return map[ext] ?? 'text';
}

// Currently unused by FileBrowser itself — provided for media-aware callers.
// viewers operating on the dedicated `/media` routes. getProjectFile returns repo-tree
// files as UTF-8 text, which would corrupt binary media; this distinction is why
// FileBrowser doesn't use this for repo-tree files.
export function detectFileKind(filePath: string): 'image' | 'video' | 'audio' | 'text' {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg'].includes(ext)) return 'audio';
  return 'text';
}

export default function FileBrowser({ spaceId, projectId, projectName = 'Repository' }: FileBrowserProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const { data: rootData, isLoading } = useQuery({
    queryKey: ['project-tree', spaceId, projectId, ''],
    queryFn: () => getProjectTree(spaceId, projectId),
    staleTime: 30000,
  });

  const { data: fileData, isLoading: fileLoading } = useQuery({
    queryKey: ['project-file', spaceId, projectId, selectedPath],
    queryFn: () => getProjectFile(spaceId, projectId, selectedPath!),
    enabled: !!selectedPath,
    staleTime: 10000,
  });

  const entries = rootData?.entries ?? [];
  const isEmpty = !isLoading && entries.length === 0;
  const lang = selectedPath ? detectLanguage(selectedPath) : 'text';
  const isMd = lang === 'markdown';

  return (
    <div className="grid min-h-[30rem] gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
      <Surface className="min-w-0 overflow-hidden bg-card">
        <div className="border-b border-border-soft px-4 py-3">
          <div className="text-sm font-semibold text-foreground">{projectName}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Repository files</div>
        </div>
        <div className="max-h-[34rem] overflow-y-auto py-2">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={14} className="animate-spin text-muted-foreground/50" />
          </div>
        )}
        {isEmpty && (
          <div className="px-3 py-3">
            <EmptyPanel
              title="No files yet"
              description="Files will appear here when the project workspace has content."
              className="text-xs"
            />
          </div>
        )}
        {entries.map(entry => (
          <TreeNode
            key={entry.path}
            entry={entry}
            spaceId={spaceId}
            projectId={projectId}
            depth={0}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
        ))}
        </div>
      </Surface>

      <Surface className="flex min-w-0 flex-col overflow-hidden bg-card">
        {!selectedPath && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-muted-foreground">Select a file to view</p>
          </div>
        )}
        {selectedPath && (
          <>
            <div className="flex h-11 shrink-0 items-center border-b border-border-soft px-4">
              <span className="truncate font-mono text-xs text-muted-foreground">{selectedPath}</span>
            </div>
            <div className="flex-1 overflow-auto">
              {fileLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={14} className="animate-spin text-muted-foreground/50" />
                </div>
              )}
              {fileData && isMd && (
                <div className="px-5 py-4 text-[14px] leading-relaxed text-fg-soft [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-foreground [&_h1:first-child]:mt-0 [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground [&_p]:mb-3 [&_p:last-child]:mb-0 [&_ul]:mb-3 [&_ul]:ml-5 [&_ul]:list-disc [&_ol]:mb-3 [&_ol]:ml-5 [&_ol]:list-decimal [&_li]:mb-1 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border-soft [&_pre]:bg-muted/30 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12px] [&_pre_code]:bg-transparent [&_pre_code]:p-0">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{fileData.content}</ReactMarkdown>
                </div>
              )}
              {fileData && !isMd && (
                <pre className="px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
                  {fileData.content}
                </pre>
              )}
            </div>
          </>
        )}
      </Surface>
    </div>
  );
}
