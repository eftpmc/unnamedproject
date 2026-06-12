import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getResearchFiles, getResearchFile } from '../lib/api.js';
import { EmptyPanel, PageLoading } from '@/components/ui/app-layout';
import { timeAgo, cn } from '../lib/utils.js';
import type { Project } from '../types.js';

export default function ResearchTab({ project }: { project: Project }) {
  const { data, isLoading: filesLoading } = useQuery({
    queryKey: ['research-files', project.id],
    queryFn: () => getResearchFiles(project.id),
    staleTime: 30_000,
  });

  const files = data?.files ?? [];
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const activeFile = selectedFile ?? files[0]?.name ?? null;

  const { data: content, isLoading: contentLoading } = useQuery({
    queryKey: ['research-file', project.id, activeFile],
    queryFn: () => getResearchFile(project.id, activeFile!),
    enabled: !!activeFile,
    staleTime: 60_000,
  });

  if (filesLoading) return <PageLoading rows={3} />;

  if (files.length === 0) {
    return (
      <EmptyPanel
        title="No research files yet"
        description="Ask the orchestrator to research a topic and findings will appear here."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* File list */}
      <div className="w-52 shrink-0 border-r border-border/40 overflow-y-auto">
        {files.map(file => (
          <button
            key={file.name}
            onClick={() => setSelectedFile(file.name)}
            className={cn(
              'flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors border-b border-border/30',
              activeFile === file.name
                ? 'bg-muted/50 text-foreground'
                : 'text-muted-foreground hover:bg-muted/20'
            )}
          >
            <span className="text-xs font-medium truncate">{file.title}</span>
            <span className="text-xs opacity-60">{timeAgo(file.createdAt)}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {contentLoading ? (
          <PageLoading rows={5} />
        ) : content ? (
          <pre className="whitespace-pre-wrap text-sm text-foreground font-sans leading-relaxed">
            {content}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
