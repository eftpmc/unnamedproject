import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  FileText,
  FolderGit2,
  Image,
  LayoutDashboard,
  MessageSquare,
  Settings,
  Files,
  Zap,
} from 'lucide-react';
import { getProject } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import type { Project } from '../types.js';

interface SidebarProps {
  expanded: boolean;
  onToggle: () => void;
}

export default function AppSidebar({ expanded, onToggle }: SidebarProps) {
  const location = useLocation();
  const params = useParams<{ projectId?: string }>();
  const isInProject = location.pathname.startsWith('/projects/') && !!params.projectId;

  const { data: project } = useQuery<Project>({
    queryKey: ['project', params.projectId],
    queryFn: () => getProject(params.projectId!),
    enabled: isInProject,
  });

  return (
    <nav
      className={cn(
        'absolute inset-y-0 left-0 z-10 flex h-full flex-col border-r border-border-soft bg-background transition-[width] duration-200',
        expanded ? 'w-56' : 'w-12',
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden py-2">
        {isInProject ? (
          <ProjectNav projectId={params.projectId!} project={project ?? null} expanded={expanded} pathname={location.pathname} />
        ) : (
          <GlobalNav expanded={expanded} pathname={location.pathname} />
        )}
      </div>
    </nav>
  );
}

function GlobalNav({ expanded, pathname }: { expanded: boolean; pathname: string }) {
  return (
    <>
      <NavItem icon={<MessageSquare size={16} strokeWidth={1.75} />} label="Chats" href="/chats" active={pathname.startsWith('/chats')} expanded={expanded} />
      <NavItem icon={<FolderGit2 size={16} strokeWidth={1.75} />} label="Projects" href="/projects" active={pathname === '/projects'} expanded={expanded} />
      <NavItem icon={<FileText size={16} strokeWidth={1.75} />} label="Documents" href="/documents" active={pathname.startsWith('/documents')} expanded={expanded} />
      <NavItem icon={<Image size={16} strokeWidth={1.75} />} label="Media" href="/media" active={pathname.startsWith('/media')} expanded={expanded} />
      <NavItem icon={<Zap size={16} strokeWidth={1.75} />} label="Triggers" href="/triggers" active={pathname.startsWith('/triggers')} expanded={expanded} />
      <div className="flex-1" />
      <NavItem icon={<Settings size={16} strokeWidth={1.75} />} label="Settings" href="/settings" active={pathname.startsWith('/settings')} expanded={expanded} />
    </>
  );
}

function ProjectNav({ projectId, project: _project, expanded, pathname }: { projectId: string; project: Project | null; expanded: boolean; pathname: string }) {
  const base = `/projects/${projectId}`;
  return (
    <>
      <NavItem icon={<ArrowLeft size={16} strokeWidth={1.75} />} label="Projects" href="/projects" active={false} expanded={expanded} />
      <div className="my-1 border-t border-border-soft" />
      <NavItem icon={<LayoutDashboard size={16} strokeWidth={1.75} />} label="Overview" href={base} active={pathname === base} expanded={expanded} />
      <NavItem icon={<Files size={16} strokeWidth={1.75} />} label="Files" href={`${base}/files`} active={pathname.startsWith(`${base}/files`)} expanded={expanded} />
      <NavItem icon={<MessageSquare size={16} strokeWidth={1.75} />} label="Chats" href={`${base}/chats`} active={pathname.startsWith(`${base}/chats`)} expanded={expanded} />
    </>
  );
}

function NavItem({ icon, label, href, active, expanded }: { icon: React.ReactNode; label: string; href: string; active: boolean; expanded: boolean }) {
  return (
    <Link
      to={href}
      title={!expanded ? label : undefined}
      className={cn(
        'flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
        'mx-1 text-muted-foreground hover:bg-muted hover:text-foreground',
        active && 'bg-muted text-foreground',
      )}
    >
      <span className="shrink-0">{icon}</span>
      {expanded && <span className="truncate">{label}</span>}
    </Link>
  );
}
