import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, Check, ChevronsUpDown, Menu, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { getProjects, getProject } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import InboxPanel from './InboxPanel.js';
import UserMenu from './UserMenu.js';
import type { Project } from '../types.js';

interface AppHeaderProps {
  onToggleSidebar?: () => void;
  onOpenSidebar?: () => void;
  pendingApprovals: Map<string, { approvalId: string; action: string; payload: Record<string, unknown> }>;
  onApprovalResolved: (executionId: string) => void;
}

export default function AppHeader({ onToggleSidebar, onOpenSidebar, pendingApprovals, onApprovalResolved }: AppHeaderProps) {
  const location = useLocation();
  const params = useParams<{ projectId?: string }>();
  const isInProject = location.pathname.startsWith('/projects/') && !!params.projectId;
  const [inboxOpen, setInboxOpen] = useState(false);

  const { data: currentProject } = useQuery<Project>({
    queryKey: ['project', params.projectId],
    queryFn: () => getProject(params.projectId!),
    enabled: isInProject,
  });

  const pendingCount = pendingApprovals.size;

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border-soft bg-background">
      <button
        type="button"
        onClick={onOpenSidebar ?? onToggleSidebar}
        aria-label={onOpenSidebar ? 'Open navigation' : 'Toggle navigation'}
        className="flex h-12 w-12 shrink-0 items-center justify-center border-r border-border-soft transition-colors hover:bg-muted sm:hidden"
      >
        <Menu size={17} strokeWidth={1.85} className="text-muted-foreground" />
      </button>

      <div className="flex min-w-0 flex-1 items-center px-3">
        {isInProject && currentProject ? (
          <ProjectSelector currentProject={currentProject} />
        ) : null}
      </div>

      <div className="flex items-center gap-1 px-3">
        <Popover open={inboxOpen} onOpenChange={setInboxOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Open inbox"
              aria-expanded={inboxOpen}
              className={cn(
                'relative grid size-8 place-items-center rounded-md transition-colors',
                inboxOpen
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Bell size={15} strokeWidth={1.75} />
              {pendingCount > 0 && (
                <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-0.5 text-[9px] font-semibold text-warning-foreground">
                  {pendingCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            side="bottom"
            sideOffset={8}
            className="w-80 p-0 shadow-lg"
          >
            <div className="flex items-center gap-2 border-b border-border-soft px-3.5 py-2.5">
              <Bell size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Inbox</span>
              {pendingCount > 0 && (
                <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-warning-foreground">
                  {pendingCount}
                </span>
              )}
            </div>
            <div className="max-h-[min(420px,calc(100vh-80px))] overflow-y-auto">
              <InboxPanel
                pendingApprovals={pendingApprovals}
                onApprovalResolved={(id) => {
                  onApprovalResolved(id);
                  if (pendingApprovals.size <= 1) setInboxOpen(false);
                }}
              />
            </div>
          </PopoverContent>
        </Popover>
        <UserMenu />
      </div>
    </header>
  );
}

function ProjectSelector({ currentProject }: { currentProject: Project }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
    staleTime: 60_000,
  });

  const filtered = search.trim()
    ? projects.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase()))
    : projects;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium transition-colors hover:bg-muted"
        >
          <span className="max-w-48 truncate">{currentProject.name}</span>
          <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex items-center gap-2 border-b border-border-soft px-3 py-2">
          <Search size={13} className="shrink-0 text-faint-fg" />
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint-fg"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.map(project => (
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
                <span className="max-w-28 shrink-0 truncate font-mono text-[11px] text-faint-fg">{project.repo_path.split('/').slice(-2).join('/')}</span>
              )}
              {project.id === currentProject.id && <Check size={13} className="shrink-0" />}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-2 text-sm text-faint-fg">No projects found.</p>
          )}
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
      </PopoverContent>
    </Popover>
  );
}
