import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronsUpDown, Check, Menu } from 'lucide-react';
import { useState } from 'react';
import { getProjects, getProject } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import UserMenu from './UserMenu.js';
import type { Project } from '../types.js';

interface AppHeaderProps {
  onToggleSidebar?: () => void;
  onOpenSidebar?: () => void;
  pendingApprovalCount: number;
  onOpenInbox: () => void;
}

export default function AppHeader({ onToggleSidebar, onOpenSidebar, pendingApprovalCount, onOpenInbox }: AppHeaderProps) {
  const location = useLocation();
  const params = useParams<{ projectId?: string }>();
  const isInProject = location.pathname.startsWith('/projects/') && !!params.projectId;

  const { data: currentProject } = useQuery<Project>({
    queryKey: ['project', params.projectId],
    queryFn: () => getProject(params.projectId!),
    enabled: isInProject,
  });

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border-soft bg-background">
      {/* Mobile: explicit menu. Desktop: logo cell aligned to collapsed sidebar. */}
      <button
        type="button"
        onClick={onOpenSidebar ?? onToggleSidebar}
        aria-label={onOpenSidebar ? 'Open navigation' : 'Toggle navigation'}
        className="flex h-12 w-12 shrink-0 items-center justify-center border-r border-border-soft transition-colors hover:bg-muted"
      >
        <Menu size={17} strokeWidth={1.85} className="text-muted-foreground sm:hidden" />
        <div className="hidden size-7 place-items-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground shadow-sm sm:grid">
          u
        </div>
      </button>

      {/* Center — project selector or empty */}
      <div className="flex min-w-0 flex-1 items-center px-3">
        {isInProject && currentProject ? (
          <ProjectSelector currentProject={currentProject} />
        ) : null}
      </div>

      {/* Right — inbox + user menu */}
      <div className="flex items-center gap-1 px-3">
        <button
          type="button"
          onClick={onOpenInbox}
          aria-label="Open inbox"
          className="relative grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Bell size={15} strokeWidth={1.75} />
          {pendingApprovalCount > 0 && (
            <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-0.5 text-[9px] font-semibold text-warning-foreground">
              {pendingApprovalCount}
            </span>
          )}
        </button>
        <UserMenu />
      </div>
    </header>
  );
}

function ProjectSelector({ currentProject }: { currentProject: Project }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
    staleTime: 60_000,
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium transition-colors hover:bg-muted"
      >
        <span className="truncate max-w-48">{currentProject.name}</span>
        <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-border bg-background shadow-lg">
            <div className="border-b border-border-soft px-3 py-2">
              <input
                autoFocus
                placeholder="Search projects..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-faint-fg"
                onClick={e => e.stopPropagation()}
              />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {projects.map(project => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => { navigate(`/projects/${project.id}`); setOpen(false); }}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                    project.id === currentProject.id && 'text-primary',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                  {project.repo_path && (
                    <span className="shrink-0 truncate font-mono text-[11px] text-faint-fg max-w-28">{project.repo_path.split('/').slice(-2).join('/')}</span>
                  )}
                  {project.id === currentProject.id && <Check size={13} className="shrink-0" />}
                </button>
              ))}
            </div>
            <div className="border-t border-border-soft px-3 py-2">
              <button
                type="button"
                onClick={() => { navigate('/projects'); setOpen(false); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                All projects →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
