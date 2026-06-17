import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MessagesSquare, LayoutGrid, Bell, KeyRound } from 'lucide-react';
import { getChats, createChat, getProjects, getActiveSessions } from '../lib/api.js';
import { timeAgo, cn } from '../lib/utils.js';
import { useWsStatus } from '../lib/useWsStatus.js';
import UserMenu from './UserMenu.js';
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '@/components/ui/sidebar';
import type { Project, Session } from '../types.js';

const RECENT_COUNT = 5;

interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
  pendingApprovalCount?: number;
  onOpenInbox?: () => void;
  hasLeadAgent?: boolean;
}

export default function Sidebar({ className, onNavigate, pendingApprovalCount = 0, onOpenInbox, hasLeadAgent = true }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isMobile, setOpenMobile } = useSidebar();
  const wsStatus = useWsStatus();

  const { data: chats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
    staleTime: 60_000,
  });
  const projectById = Object.fromEntries(projects.map(p => [p.id, p]));

  const { data: activeData } = useQuery({
    queryKey: ['active-sessions'],
    queryFn: getActiveSessions,
    refetchInterval: 5_000,
    staleTime: 0,
  });
  const activeIds = new Set(activeData?.ids ?? []);

  async function handleNewChat() {
    try {
      const { id } = await createChat();
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      navigate(`/c/${id}`);
      closeSidebar();
    } catch (err) {
      console.error('Failed to create chat:', err);
    }
  }

  const activeChatId = location.pathname.startsWith('/c/')
    ? location.pathname.split('/')[2]
    : null;

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  const recentChats = chats.slice(0, RECENT_COUNT);

  function closeSidebar() {
    onNavigate?.();
    if (isMobile) setOpenMobile(false);
  }

  function go(path: string) {
    navigate(path);
    closeSidebar();
  }

  return (
    <SidebarRoot
      className={cn('border-r border-sidebar-border bg-sidebar', className)}
      collapsible="offcanvas"
    >
      {/* ---- Header ---- */}
      <SidebarHeader className="gap-3 px-3 py-3">
        <div className="flex items-center gap-2 px-1">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground shadow-sm">
            u
          </div>
          <span className="text-sm font-semibold">unnamed</span>
        </div>
        <button
          onClick={handleNewChat}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-[filter,transform] hover:brightness-105 active:translate-y-px"
        >
          <Plus size={14} strokeWidth={2} />
          New chat
        </button>
      </SidebarHeader>

      {/* ---- Nav + Recent ---- */}
      <SidebarContent>
        <SidebarGroup className="pb-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem
                icon={<MessagesSquare size={15} strokeWidth={1.75} />}
                label="Chats"
                href="/chats"
                active={isActive('/chats')}
                onClick={closeSidebar}
              />
              <NavItem
                icon={<LayoutGrid size={15} strokeWidth={1.75} />}
                label="Projects"
                href="/projects"
                active={isActive('/projects')}
                onClick={closeSidebar}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {recentChats.length > 0 && (
          <SidebarGroup className="min-h-0 flex-1 pt-1">
            <SidebarGroupLabel className="h-6 px-2 text-[11px] font-semibold text-faint-fg">
              Recent
            </SidebarGroupLabel>
            <SidebarGroupContent className="min-h-0 flex-1">
              <div className="min-w-0 overflow-hidden">
                <ul className="flex w-full flex-col gap-0 pb-2 pr-1">
                  {recentChats.map(chat => {
                    const project = chat.pinned_project_id ? projectById[chat.pinned_project_id] : null;
                    return (
                      <li key={chat.id} className="w-full min-w-0">
                        <button
                          aria-label={`Open chat: ${chat.title ?? 'Untitled'}`}
                          onClick={() => go(`/c/${chat.id}`)}
                          className={cn(
                            'flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent',
                            activeChatId === chat.id &&
                              'bg-sidebar-accent shadow-xs ring-1 ring-sidebar-border',
                          )}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            {activeIds.has(chat.id) && (
                              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
                            )}
                            <span className="block truncate text-xs font-medium text-foreground">
                              {chat.title ?? 'Untitled chat'}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
                            <span className="shrink-0 text-[11px] text-faint-fg">{timeAgo(chat.updated_at)}</span>
                            {project && (
                              <>
                                <span className="text-faint-fg text-[11px]">·</span>
                                <span className="min-w-0 truncate text-[11px] text-faint-fg">{project.name}</span>
                              </>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {chats.length > RECENT_COUNT && (
                  <Link
                    to="/chats"
                    onClick={closeSidebar}
                    className="block px-2.5 pb-1 text-[11px] text-faint-fg transition-colors hover:text-muted-foreground"
                  >
                    See all {chats.length} chats →
                  </Link>
                )}
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {recentChats.length === 0 && <div className="flex-1" />}
      </SidebarContent>

      {/* ---- Setup nudge ---- */}
      {!hasLeadAgent && (
        <div className="mx-2 mb-2">
          <button
            type="button"
            onClick={() => go('/settings')}
            className="flex w-full items-center gap-2.5 rounded-lg border border-warning/35 bg-warning/[0.07] px-3 py-2.5 text-left transition-colors hover:bg-warning/[0.12]"
          >
            <KeyRound size={13} className="shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-foreground">API key needed</div>
              <div className="text-[11px] text-muted-foreground">Set up in Settings → Agents</div>
            </div>
          </button>
        </div>
      )}

      {/* ---- Footer: inbox bell + account menu ---- */}
      <SidebarFooter className="border-t border-sidebar-border px-2.5 py-2.5">
        {wsStatus === 'disconnected' && (
          <div className="mb-2 flex items-center gap-2 rounded-md bg-warning/10 px-2.5 py-1.5">
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-warning" />
            <span className="text-[11px] font-medium text-warning">Reconnecting…</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenInbox}
            aria-label="Open inbox"
            className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Bell size={15} strokeWidth={1.75} />
            {pendingApprovalCount > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-0.5 text-[9px] font-semibold leading-none text-warning-foreground">
                {pendingApprovalCount}
              </span>
            )}
          </button>
          <div className="flex-1">
            <UserMenu />
          </div>
        </div>
      </SidebarFooter>
    </SidebarRoot>
  );
}

function NavItem({
  icon,
  label,
  href,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  active: boolean;
  onClick?: () => void;
  badge?: number;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        className={cn(
          'h-9 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
          active && 'bg-sidebar-accent text-foreground shadow-xs ring-1 ring-sidebar-border/60',
        )}
      >
        <Link to={href} onClick={onClick}>
          {icon}
          <span className="flex-1">{label}</span>
          {badge != null && (
            <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-warning-foreground">
              {badge}
            </span>
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
