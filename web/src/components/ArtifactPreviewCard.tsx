import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowRight, FileText } from 'lucide-react';
import { getArtifactContent } from '../lib/api.js';
import { getToken } from '../lib/auth.js';
import { Surface } from '@/components/ui/app-layout';
import { cn } from '@/lib/utils';

const KIND_LABEL: Record<string, string> = {
  research: 'Research',
  report: 'Report',
  summary: 'Summary',
  design: 'Design',
  test_report: 'Test Report',
  media: 'Media',
};

const PREVIEW_CHAR_LIMIT = 1200;

const markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[11px]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-border/30 bg-muted/30 p-2.5 text-[11px] font-mono leading-relaxed">{children}</pre>
  ),
  ul: ({ children }) => <ul className="mb-2 ml-3.5 list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-3.5 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  h1: ({ children }) => <h1 className="mb-2 text-sm font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 text-xs font-semibold text-foreground/80">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 text-xs font-medium text-foreground/70">{children}</h3>,
};

interface ArtifactPreviewCardProps {
  artifactId: string;
  projectId: string;
  title: string;
  kind: string;
  mimeType?: string;
}

export default function ArtifactPreviewCard({ artifactId, projectId, title, kind, mimeType }: ArtifactPreviewCardProps) {
  const [expanded, setExpanded] = useState(false);

  const isText = !mimeType || mimeType === 'text/markdown' || mimeType === 'text/plain' || mimeType === 'application/json';
  const isMarkdown = !mimeType || mimeType === 'text/markdown';

  const contentUrl = `/projects/${projectId}/artifacts/${artifactId}/content`;

  const { data: content, isLoading } = useQuery({
    queryKey: ['artifact-content', artifactId],
    queryFn: () => getArtifactContent(contentUrl),
    enabled: isText,
    staleTime: 60_000,
  });

  const truncated = content && !expanded && content.length > PREVIEW_CHAR_LIMIT;
  const displayed = truncated ? content.slice(0, PREVIEW_CHAR_LIMIT) : content;

  return (
    <Surface className="w-full overflow-hidden rounded-2xl border-border/25 bg-background shadow-sm ring-1 ring-black/[0.03]">
      <div className="flex items-center gap-2.5 border-b border-border/35 bg-muted/15 px-3 py-2">
        <FileText size={13} className="shrink-0 text-muted-foreground/60" />
        <span className="flex-1 truncate text-xs font-semibold text-foreground">{title}</span>
        <span className="shrink-0 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
          {KIND_LABEL[kind] ?? kind}
        </span>
      </div>

      {isText && (
        <div className={cn('px-3 py-3 text-xs text-foreground/75 leading-relaxed', !expanded && 'max-h-64 overflow-hidden')}>
          {isLoading ? (
            <span className="text-muted-foreground/50">Loading…</span>
          ) : displayed ? (
            isMarkdown ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {displayed}
              </ReactMarkdown>
            ) : (
              <pre className="whitespace-pre-wrap font-mono text-[11px]">{displayed}</pre>
            )
          ) : (
            <span className="text-muted-foreground/50">No content</span>
          )}
          {truncated && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-1 text-[11px] text-indigo-500 hover:text-indigo-400 transition-colors"
            >
              Show more
            </button>
          )}
        </div>
      )}

      <div className="border-t border-border/35 px-3 py-2">
        <Link
          to={`/projects/${projectId}/artifacts`}
          className="flex items-center justify-center gap-1.5 text-xs font-medium text-foreground/70 transition-colors hover:text-foreground"
        >
          View in Artifacts
          <ArrowRight size={12} />
        </Link>
      </div>
    </Surface>
  );
}
