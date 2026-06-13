import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Image, Loader2, Package, Video } from 'lucide-react';
import { getArtifactContent, getProjectArtifacts } from '../lib/api.js';
import { EmptyPanel, PageLoading, Surface } from '@/components/ui/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { timeAgo } from '../lib/utils.js';
import type { Project, ProjectArtifact } from '../types.js';

const STATUS_CLASS: Record<ProjectArtifact['status'], string> = {
  ready: 'bg-green-500/10 text-green-700 border-green-200/70 dark:text-green-300 dark:border-green-900',
  review: 'bg-warning/10 text-foreground border-warning/25',
  running: 'bg-blue-500/10 text-blue-700 border-blue-200/70 dark:text-blue-300 dark:border-blue-900',
  error: 'bg-destructive/10 text-destructive border-destructive/20',
};

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
    return <video controls src={artifact.url} className="w-full rounded-lg border border-border/40 bg-black" />;
  }

  if (artifact.mime_type.startsWith('image/') && artifact.url) {
    return <img src={artifact.url} alt={artifact.title} className="max-h-[420px] w-full rounded-lg border border-border/40 object-contain" />;
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
    <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visible.map(artifact => {
            const Icon = artifactIcon(artifact.mime_type);
            const isSelected = selected?.id === artifact.id;
            return (
              <button
                key={artifact.id}
                onClick={() => setSelectedId(artifact.id)}
                className="block text-left"
              >
                <Surface interactive className={cn('p-4', isSelected && 'border-foreground/35 bg-background/85')}>
                  <div className="flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border/50 bg-muted/25">
                      <Icon size={16} className="text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">{artifact.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{kindLabel(artifact.kind)}</span>
                        <span className="text-muted-foreground/35">·</span>
                        <span>{timeAgo(artifact.created_at)}</span>
                      </div>
                    </div>
                    <Badge variant="outline" className={cn('capitalize', STATUS_CLASS[artifact.status])}>
                      {artifact.status}
                    </Badge>
                  </div>
                  {artifact.description && (
                    <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {artifact.description}
                    </p>
                  )}
                </Surface>
              </button>
            );
          })}
        </div>
      </div>

      <Surface className="min-w-0 p-4">
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
      </Surface>
    </div>
  );
}
