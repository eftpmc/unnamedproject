import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Image, Loader2, Package, Video } from 'lucide-react';
import { getArtifactContent, getProjectArtifacts } from '../lib/api.js';
import { getToken } from '../lib/auth.js';
import { EmptyPanel, PageLoading } from '@/components/ui/app-layout';
import { StatusPill } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
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
  return kind
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function ArtifactPreview({ artifact }: { artifact: ProjectArtifact }) {
  const { data: content, isLoading } = useQuery({
    queryKey: ['artifact-content', artifact.project_id, artifact.id],
    queryFn: () => getArtifactContent(artifact.content_url!),
    enabled: !!artifact.content_url && (artifact.mime_type.startsWith('text/') || artifact.mime_type === 'application/json'),
    staleTime: 60_000,
  });

  if (artifact.mime_type.startsWith('video/') && artifact.url) {
    const token = getToken();
    const src = token ? `${artifact.url}?token=${encodeURIComponent(token)}` : artifact.url;
    return <video controls src={src} className="w-full rounded-lg border border-border/40 bg-black" />;
  }

  if (artifact.mime_type.startsWith('image/') && artifact.url) {
    const token = getToken();
    const src = token ? `${artifact.url}?token=${encodeURIComponent(token)}` : artifact.url;
    return <img src={src} alt={artifact.title} className="max-h-[420px] w-full rounded-lg border border-border/40 object-contain" />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border/40 bg-muted/20 py-16">
        <Loader2 size={15} className="animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  if (content) {
    return (
      <div className="max-h-[460px] overflow-y-auto rounded-lg border border-border/40 bg-background/60 p-4 text-sm leading-relaxed">
        {artifact.mime_type === 'application/json' ? (
          <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">{content}</pre>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-6 text-sm text-muted-foreground">
      No preview is available for this artifact type.
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
        description="When the orchestrator produces inspectable outputs, they will appear here."
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button size="sm" variant={kind === 'all' ? 'default' : 'outline'} className="h-8 text-xs" onClick={() => setKind('all')}>
            All
          </Button>
          {kinds.map(k => (
            <Button key={k} size="sm" variant={kind === k ? 'default' : 'outline'} className="h-8 text-xs" onClick={() => setKind(k)}>
              {kindLabel(k)}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map(artifact => {
            const Icon = artifactIcon(artifact.mime_type);
            const isSelected = selected?.id === artifact.id;
            return (
              <button
                key={artifact.id}
                onClick={() => setSelectedId(artifact.id)}
                className={cn(
                  'group flex min-w-0 flex-col gap-3 rounded-lg border border-border-soft bg-card p-4 text-left transition-[transform,box-shadow,border-color]',
                  'hover:-translate-y-px hover:border-border hover:shadow-sm',
                  isSelected && 'border-border bg-background/85 shadow-sm',
                )}
              >
                <div className="grid aspect-[16/10] w-full place-items-center rounded-md border border-border-soft bg-muted/35 bg-[repeating-linear-gradient(45deg,color-mix(in_oklch,var(--muted)_90%,transparent),color-mix(in_oklch,var(--muted)_90%,transparent)_8px,transparent_8px,transparent_16px)]">
                  <div className="inline-flex items-center gap-1.5 rounded-md border border-border-soft bg-background/75 px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
                    <Icon size={12} />
                    {artifact.mime_type}
                  </div>
                </div>
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{artifact.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{kindLabel(artifact.kind)}</span>
                      <span className="text-border">·</span>
                      <span>{timeAgo(artifact.created_at)}</span>
                    </div>
                  </div>
                  <StatusPill status={artifact.status} />
                </div>
                {artifact.description && (
                  <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {artifact.description}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-w-0 rounded-lg border border-border-soft bg-card p-4">
        {selected ? (
          <div className="flex flex-col gap-4">
            <div>
              <div className="text-sm font-semibold text-foreground">{selected.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {kindLabel(selected.kind)} · {selected.mime_type}
              </div>
            </div>
            <ArtifactPreview artifact={selected} />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Select an artifact to preview it.</div>
        )}
      </div>
    </div>
  );
}
