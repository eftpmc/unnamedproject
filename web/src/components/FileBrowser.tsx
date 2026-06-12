import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen, Loader2 } from 'lucide-react';
import { getProjectTree, getProjectFile } from '../lib/api.js';
import { cn } from '@/lib/utils';
import { EmptyPanel, Surface } from '@/components/ui/app-layout';
import type { FileEntry } from '../types.js';

interface FileBrowserProps {
  projectId: string;
}

interface TreeNodeProps {
  entry: FileEntry;
  projectId: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function TreeNode({ entry, projectId, depth, selectedPath, onSelect }: TreeNodeProps) {
  const [open, setOpen] = useState(false);
  const { data, isFetching } = useQuery({
    queryKey: ['project-tree', projectId, entry.path],
    queryFn: () => getProjectTree(projectId, entry.path),
    enabled: entry.type === 'dir' && open,
    staleTime: 30000,
  });

  if (entry.type === 'file') {
    return (
      <button
        onClick={() => onSelect(entry.path)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted/60',
          selectedPath === entry.path && 'bg-muted text-foreground font-medium',
          selectedPath !== entry.path && 'text-muted-foreground',
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <FileText size={12} className="shrink-0 opacity-60" />
        <span className="truncate">{entry.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/60"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {isFetching
          ? <Loader2 size={12} className="shrink-0 animate-spin opacity-60" />
          : open
            ? <ChevronDown size={12} className="shrink-0 opacity-60" />
            : <ChevronRight size={12} className="shrink-0 opacity-60" />
        }
        {open ? <FolderOpen size={12} className="shrink-0 opacity-70" /> : <Folder size={12} className="shrink-0 opacity-70" />}
        <span className="truncate font-medium">{entry.name}</span>
      </button>
      {open && data?.entries.map(child => (
        <TreeNode
          key={child.path}
          entry={child}
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

// Currently unused by FileBrowser itself — provided for use by StudioTab/media-aware
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

export default function FileBrowser({ projectId }: FileBrowserProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const { data: rootData, isLoading } = useQuery({
    queryKey: ['project-tree', projectId, ''],
    queryFn: () => getProjectTree(projectId),
    staleTime: 30000,
  });

  const { data: fileData, isLoading: fileLoading } = useQuery({
    queryKey: ['project-file', projectId, selectedPath],
    queryFn: () => getProjectFile(projectId, selectedPath!),
    enabled: !!selectedPath,
    staleTime: 10000,
  });

  const entries = rootData?.entries ?? [];
  const isEmpty = !isLoading && entries.length === 0;
  const lang = selectedPath ? detectLanguage(selectedPath) : 'text';
  const isMd = lang === 'markdown';

  return (
    <Surface className="flex min-h-0 flex-1 overflow-hidden bg-background/40">
      {/* Tree panel */}
      <div className="w-52 shrink-0 overflow-y-auto border-r border-border/40 py-2">
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
            projectId={projectId}
            depth={0}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
        ))}
      </div>

      {/* File viewer */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!selectedPath && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-muted-foreground/40">Select a file to view</p>
          </div>
        )}
        {selectedPath && (
          <>
            <div className="flex h-9 shrink-0 items-center border-b border-border/40 px-3">
              <span className="truncate font-mono text-xs text-muted-foreground">{selectedPath}</span>
            </div>
            <div className="flex-1 overflow-auto">
              {fileLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={14} className="animate-spin text-muted-foreground/50" />
                </div>
              )}
              {fileData && isMd && (
                <div className="prose prose-sm dark:prose-invert max-w-none px-4 py-3 text-sm">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{fileData.content}</pre>
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
      </div>
    </Surface>
  );
}
