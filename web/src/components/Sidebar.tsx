import { useState } from 'react';
import { useCommandPalette } from './CommandPalette.js';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  Database,
  FileText,
  FolderGit2,
  FolderOpen,
  Image,
  LayoutDashboard,
  Layers,
  MessageSquare,
  Palette,
  Plug,
  Search,
  Settings,
  Files,
  Wrench,
  Zap,
} from 'lucide-react';
import { cn } from '../lib/utils.js';

interface SidebarProps {
  pinned: boolean;
  onTogglePin: () => void;
  mobile?: boolean;
  onNavigate?: () => void;
}

export default function AppSidebar({ pinned, onTogglePin, mobile = false, onNavigate }: SidebarProps) {
  const [hovered, setHovered] = useState(false);
  const expanded = mobile || pinned || hovered;

  const location = useLocation();
  const params = useParams<{ projectId?: string }>();
  const isInProject = location.pathname.startsWith('/projects/') && !!params.projectId;

  return (
    <nav
      className={cn(
        'flex h-full flex-col border-r border-border-soft bg-background transition-[width] duration-200',
        mobile ? 'w-full' : ['absolute inset-y-0 left-0 z-10', expanded ? 'w-56' : 'w-12'],
      )}
      onMouseEnter={() => !mobile && setHovered(true)}
      onMouseLeave={() => !mobile && setHovered(false)}
    >
      <button
        type="button"
        onClick={mobile ? undefined : onTogglePin}
        title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
        aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
        className={cn(
          'flex h-12 shrink-0 items-center gap-3 border-b border-border-soft px-2.5 text-left',
          !mobile && 'transition-colors hover:bg-muted',
        )}
      >
        <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground shadow-sm">
          u
        </div>
        {expanded && (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            unnamed
          </span>
        )}
      </button>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden py-2">
        {isInProject ? (
          <ProjectNav projectId={params.projectId!} expanded={expanded} pathname={location.pathname} onNavigate={onNavigate} />
        ) : (
          <GlobalNav expanded={expanded} pathname={location.pathname} onNavigate={onNavigate} />
        )}
      </div>

      {!mobile && (
        <button
          type="button"
          onClick={onTogglePin}
          title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
          className="flex h-10 shrink-0 items-center border-t border-border-soft px-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRight
            size={16}
            strokeWidth={1.75}
            className={cn('shrink-0 transition-transform duration-200', pinned && 'rotate-180')}
          />
          {expanded && <span className="ml-3 truncate text-sm">{pinned ? 'Collapse' : 'Pin open'}</span>}
        </button>
      )}
    </nav>
  );
}

function GlobalNav({ expanded, pathname, onNavigate }: { expanded: boolean; pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <QuickSearch expanded={expanded} onNavigate={onNavigate} />

      <NavItem icon={<LayoutDashboard size={16} strokeWidth={1.75} />} label="Home" href="/home" active={pathname === '/home'} expanded={expanded} onNavigate={onNavigate} />
      <NavItem icon={<MessageSquare size={16} strokeWidth={1.75} />} label="Chats" href="/chats" active={pathname.startsWith('/chats') || pathname.startsWith('/c')} expanded={expanded} onNavigate={onNavigate} />
      <NavItem icon={<FolderGit2 size={16} strokeWidth={1.75} />} label="Projects" href="/projects" active={pathname === '/projects'} expanded={expanded} onNavigate={onNavigate} />

      <NavGroup
        icon={<Layers size={16} strokeWidth={1.75} />}
        label="Library"
        expanded={expanded}
        active={pathname.startsWith('/documents') || pathname.startsWith('/media')}
        fallbackHref="/documents"
        storageKey="sidebar:library"
        defaultOpen
        onNavigate={onNavigate}
      >
        <NavSubItem label="Documents" href="/documents" active={pathname.startsWith('/documents')} icon={<FileText size={13} strokeWidth={1.75} />} onNavigate={onNavigate} />
        <NavSubItem label="Media" href="/media" active={pathname.startsWith('/media')} icon={<Image size={13} strokeWidth={1.75} />} onNavigate={onNavigate} />
      </NavGroup>

      <NavItem icon={<Zap size={16} strokeWidth={1.75} />} label="Triggers" href="/triggers" active={pathname.startsWith('/triggers')} expanded={expanded} onNavigate={onNavigate} />

      <div className="my-1 mx-2 border-t border-border-soft" />

      <NavGroup
        icon={<Settings size={16} strokeWidth={1.75} />}
        label="Settings"
        expanded={expanded}
        active={pathname.startsWith('/settings')}
        fallbackHref="/settings/tools"
        storageKey="sidebar:settings"
        defaultOpen={pathname.startsWith('/settings')}
        onNavigate={onNavigate}
      >
        <NavSubItem label="Tools" href="/settings/tools" active={pathname === '/settings/tools'} icon={<Wrench size={13} strokeWidth={1.75} />} onNavigate={onNavigate} />
        <NavSubItem label="MCP" href="/settings/mcp" active={pathname === '/settings/mcp'} icon={<Plug size={13} strokeWidth={1.75} />} onNavigate={onNavigate} />
        <NavSubItem label="Workspace" href="/settings/workspace" active={pathname === '/settings/workspace'} icon={<FolderOpen size={13} strokeWidth={1.75} />} onNavigate={onNavigate} />
        <NavSubItem label="Memory" href="/settings/memory" active={pathname === '/settings/memory'} icon={<Database size={13} strokeWidth={1.75} />} onNavigate={onNavigate} />
        <NavSubItem label="Appearance" href="/settings/appearance" active={pathname === '/settings/appearance'} icon={<Palette size={13} strokeWidth={1.75} />} onNavigate={onNavigate} />
      </NavGroup>
    </>
  );
}

function QuickSearch({ expanded, onNavigate }: { expanded: boolean; onNavigate?: () => void }) {
  const { open } = useCommandPalette();

  function handleClick() {
    open();
    onNavigate?.();
  }

  if (!expanded) {
    return (
      <button
        type="button"
        title="Quick search (⌘K)"
        onClick={handleClick}
        className="flex h-9 items-center justify-center rounded-md mx-1 mb-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Search size={16} strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-border-soft bg-muted/40 px-2.5 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Search size={13} className="shrink-0" />
      <span className="flex-1">Quick search...</span>
      <kbd className="shrink-0 rounded bg-background px-1 py-0.5 text-[10px] font-medium text-faint-fg shadow-sm">⌘K</kbd>
    </button>
  );
}

function NavGroup({
  icon,
  label,
  expanded,
  active,
  fallbackHref,
  storageKey,
  defaultOpen = false,
  children,
  onNavigate,
}: {
  icon: React.ReactNode;
  label: string;
  expanded: boolean;
  active: boolean;
  fallbackHref: string;
  storageKey?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) return stored === 'true';
    }
    return defaultOpen;
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey) localStorage.setItem(storageKey, String(next));
  };

  // Collapsed sidebar: show the group icon as a single link
  if (!expanded) {
    return (
      <Link
        to={fallbackHref}
        title={label}
        onClick={onNavigate}
        className={cn(
          'flex h-9 items-center justify-center rounded-md mx-1 transition-colors text-muted-foreground hover:bg-muted hover:text-foreground',
          active && 'bg-muted text-foreground',
        )}
      >
        <span className="shrink-0">{icon}</span>
      </Link>
    );
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'flex h-9 items-center gap-3 rounded-md mx-1 px-3 text-sm font-medium transition-colors text-muted-foreground hover:bg-muted hover:text-foreground',
          active && !open && 'text-foreground',
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span className="flex-1 truncate text-left">{label}</span>
        <ChevronRight
          size={14}
          strokeWidth={1.75}
          className={cn('shrink-0 text-faint-fg transition-transform duration-150', open && 'rotate-90')}
        />
      </button>
      {open && <div className="flex flex-col gap-0.5 pb-1">{children}</div>}
    </div>
  );
}

function NavSubItem({
  label,
  href,
  active,
  icon,
  onNavigate,
}: {
  label: string;
  href: string;
  active: boolean;
  icon?: React.ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={href}
      onClick={onNavigate}
      className={cn(
        'flex h-8 items-center gap-2 rounded-md pl-9 pr-3 text-sm transition-colors mx-1 text-muted-foreground hover:bg-muted hover:text-foreground',
        active && 'bg-muted text-foreground font-medium',
      )}
    >
      {icon && <span className="shrink-0 text-faint-fg">{icon}</span>}
      <span className="truncate">{label}</span>
    </Link>
  );
}

function ProjectNav({ projectId, expanded, pathname, onNavigate }: { projectId: string; expanded: boolean; pathname: string; onNavigate?: () => void }) {
  const base = `/projects/${projectId}`;
  return (
    <>
      <QuickSearch expanded={expanded} onNavigate={onNavigate} />
      <NavItem icon={<ArrowLeft size={16} strokeWidth={1.75} />} label="Back" href="/projects" active={false} expanded={expanded} onNavigate={onNavigate} />
      <div className="my-1 border-t border-border-soft" />
      <NavItem icon={<LayoutDashboard size={16} strokeWidth={1.75} />} label="Overview" href={base} active={pathname === base} expanded={expanded} onNavigate={onNavigate} />
      <NavItem icon={<Files size={16} strokeWidth={1.75} />} label="Files" href={`${base}/files`} active={pathname.startsWith(`${base}/files`)} expanded={expanded} onNavigate={onNavigate} />
      <NavItem icon={<MessageSquare size={16} strokeWidth={1.75} />} label="Chats" href={`${base}/chats`} active={pathname.startsWith(`${base}/chats`)} expanded={expanded} onNavigate={onNavigate} />
    </>
  );
}

function NavItem({
  icon,
  label,
  href,
  active,
  expanded,
  onNavigate,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  active: boolean;
  expanded: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={href}
      title={!expanded ? label : undefined}
      onClick={onNavigate}
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
