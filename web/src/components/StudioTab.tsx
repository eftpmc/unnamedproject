import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { EmptyPanel, Surface } from '@/components/ui/app-layout';
import { getProjectMedia, mediaFileUrl } from '../lib/api.js';
import type { Project } from '../types.js';

export default function StudioTab({ project }: { project: Project }) {
  const { data, isLoading } = useQuery({
    queryKey: ['project-media', project.id],
    queryFn: () => getProjectMedia(project.id),
    staleTime: 10000,
  });

  const files = data?.files ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={14} className="animate-spin text-muted-foreground/50" />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <EmptyPanel
        title="No videos yet"
        description="Ask the agent to generate one for this project."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {files.map(file => (
        <Surface key={file.name} className="p-3">
          <video
            controls
            src={mediaFileUrl(project.id, file.name)}
            className="w-full rounded"
          />
          <div className="mt-2 truncate text-xs text-muted-foreground">{file.name}</div>
        </Surface>
      ))}
    </div>
  );
}
