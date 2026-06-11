import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getProjects } from '../lib/api.js';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Project } from '../types.js';

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
  });

  if (isLoading) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between px-6">
        <h1 className="text-sm font-medium">Projects</h1>
        <Button size="sm" variant="outline" onClick={() => navigate('/settings')}>
          Manage in Settings
        </Button>
      </header>

      {projects.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-muted-foreground/60">No projects yet.</p>
            <Button className="mt-3" size="sm" onClick={() => navigate('/settings')}>
              Go to Settings
            </Button>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="px-6 pb-6">
            <div className="divide-y divide-border/50 rounded-2xl border border-border/50 bg-background/40">
              {projects.map((project: Project) => (
                <div key={project.id} className="px-4 py-3">
                  <div className="text-sm font-medium">{project.name}</div>
                  {project.description && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{project.description}</div>
                  )}
                  {project.repo_path && (
                    <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground/60">{project.repo_path}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
