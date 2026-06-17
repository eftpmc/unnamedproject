import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, Download, FileText, Image, Loader2, Package, Video } from 'lucide-react';
import { getArtifactContent, getProjectArtifacts } from '../lib/api.js';
import { getToken } from '../lib/auth.js';
import { EmptyPanel, PageLoading } from '@/components/ui/app-layout';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import { timeAgo } from '../lib/utils.js';
import type { Project, ProjectArtifact } from '../types.js';

function artifactIcon(mimeType: string) {
  if (mimeType.startsWith('video/')) return Video;
  if (mimeType.startsWith('image/')) return Image;
  if (mimeType.startsWith('text/') || mimeType === 'application/json') return FileText;
  return Package;
}

function kindLabel(kind: string) {
  return kind.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  p:      ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  code:   ({ children }) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground/85">{children}</code>,
  pre:    ({ children }) => <pre className="my-3 overflow-x-auto rounded-xl border border-border-soft bg-muted/30 p-3 font-mono text-[12px] leading-relaxed">{children}</pre>,
  ul:     ({ children }) => <ul className="mb-3 ml-5 list-disc">{children}</ul>,
  ol:     ({ children }) => <ol className="mb-3 ml-5 list-decimal">{children}</ol>,
  li:     ({ children }) => <li className="mb-1">{children}</li>,
  h1:     ({ children }) => <h1 className="mb-3 mt-5 text-lg font-semibold text-foreground first:mt-0">{children}</h1>,
  h2:     ({ children }) => <h2 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0">{children}</h2>,
  h3:     ({ children }) => <h3 className="mb-2 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h3>,
  table:  ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border/40">
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/45 text-foreground/80">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-border/35">{children}</tbody>,
  tr:    ({ children }) => <tr className="divide-x divide-border/35">{children}</tr>,
  th:    ({ children }) => <th className="px-3 py-2 font-semibold whitespace-nowrap">{children}</th>,
  td:    ({ children }) => <td className="px-3 py-2 align-top text-foreground/80">{children}</td>,
};

function CopyButton({ getText }: { getText: () => string | undefined }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    const text = getText();
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1.5 rounded-lg border border-border-soft bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
    >
      {copied ? <Check size={12} strokeWidth={2.5} className="text-success" /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function DownloadButton({ artifact }: { artifact: ProjectArtifact }) {
  const [loading, setLoading] = useState(false);
  async function handleDownload() {
    const url = artifact.url ?? artifact.content_url;
    if (!url) return;
    setLoading(true);
    try {
      const token = getToken();
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = artifact.title;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setLoading(false);
    }
  }
  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg border border-border-soft bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-50"
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
      Download
    </button>
  );
}

function ArtifactViewer({ artifact }: { artifact: ProjectArtifact }) {
  const isText = artifact.mime_type.startsWith('text/') || artifact.mime_type === 'application/json';
  const isMarkdown = artifact.mime_type === 'text/markdown' || artifact.mime_type === 'text/plain';
  const isImage = artifact.mime_type.startsWith('image/');
  const isVideo = artifact.mime_type.startsWith('video/');

  const { data: content, isLoading } = useQuery({
    queryKey: ['artifact-content', artifact.id],
    queryFn: () => getArtifactContent(artifact.content_url!),
    enabled: isText && !!artifact.content_url,
    staleTime: 60_000,
  });

  const authedUrl = (url: string) => {
    const token = getToken();
    return token ? `${url}?token=${encodeURIComponent(token)}` : url;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border-soft px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{artifact.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{kindLabel(artifact.kind)}</span>
            <span className="text-border">·</span>
            <span>{artifact.mime_type}</span>
            <span className="text-border">·</span>
            <span>{timeAgo(artifact.created_at)}</span>
          </div>
          {artifact.description && (
            <p className="mt-1.5 text-xs text-muted-foreground">{artifact.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={artifact.status} />
          {isText && content && <CopyButton getText={() => content} />}
          {(isImage || isVideo) && artifact.url && <DownloadButton artifact={artifact} />}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {isVideo && artifact.url && (
          <video controls src={authedUrl(artifact.url)} className="w-full rounded-xl border border-border/40 bg-black" />
        )}

        {isImage && artifact.url && (
          <img src={authedUrl(artifact.url)} alt={artifact.title} className="max-h-[560px] w-full rounded-xl border border-border/40 object-contain" />
        )}

        {isText && (
          isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={16} className="animate-spin text-muted-foreground/50" />
            </div>
          ) : content ? (
            <div className="text-[14px] leading-relaxed text-fg-soft">
              {isMarkdown ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {content}
                </ReactMarkdown>
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-[13px] text-muted-foreground">{content}</pre>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No content available.</p>
          )
        )}

        {!isText && !isImage && !isVideo && (
          <div className="rounded-xl border border-border-soft bg-muted/20 p-8 text-center text-sm text-muted-foreground">
            No preview available for this artifact type.
            {artifact.url && <DownloadButton artifact={artifact} />}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ArtifactsTab({ project }: { project: Project }) {
  const { data, isLoading } = useQuery({
    queryKey: ['project-artifacts', project.id],
    queryFn: () => getProjectArtifacts(project.id),
    staleTime: 20_000,
  });

  const artifacts = data?.artifacts ?? [];
  const kinds = useMemo(() => Array.from(new Set(artifacts.map(a => a.kind))).sort(), [artifacts]);
  const [kind, setKind] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = kind === 'all' ? artifacts : artifacts.filter(a => a.kind === kind);
  const selected = artifacts.find(a => a.id === selectedId) ?? visible[0] ?? null;

  if (isLoading) return <PageLoading rows={3} />;

  if (artifacts.length === 0) {
    return (
      <EmptyPanel
        title="No artifacts yet"
        description="When the orchestrator produces outputs, they will appear here."
      />
    );
  }

  return (
    <div className="flex min-h-0 h-full">
      {/* Left: artifact list */}
      <div className="flex w-64 shrink-0 flex-col border-r border-border-soft">
        {kinds.length > 1 && (
          <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border-soft px-3 py-3">
            <button
              type="button"
              onClick={() => setKind('all')}
              className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors', kind === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
            >
              All
            </button>
            {kinds.map(k => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors', kind === k ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
              >
                {kindLabel(k)}
              </button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.map(artifact => {
            const Icon = artifactIcon(artifact.mime_type);
            const isSelected = selected?.id === artifact.id;
            return (
              <button
                key={artifact.id}
                type="button"
                onClick={() => setSelectedId(artifact.id)}
                className={cn(
                  'flex w-full min-w-0 flex-col gap-1 border-b border-border-soft/60 px-3 py-3 text-left transition-colors',
                  isSelected ? 'bg-sidebar-accent' : 'hover:bg-muted/40',
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Icon size={12} className="shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-xs font-medium text-foreground">{artifact.title}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">{timeAgo(artifact.created_at)}</span>
                  <StatusPill status={artifact.status} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: viewer */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selected ? (
          <ArtifactViewer artifact={selected} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select an artifact to view it.
          </div>
        )}
      </div>
    </div>
  );
}
