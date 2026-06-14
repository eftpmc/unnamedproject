import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MessagesSquare, LayoutGrid, Activity, Settings, Sun, Moon } from 'lucide-react';
import { getChats, createChat } from '../lib/api.js';
import { timeAgo, cn } from '../lib/utils.js';
import { useTheme } from '../lib/useTheme.js';
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
import type { Session } from '../types.js';

const RECENT_COUNT = 5;

interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
  pendingApprovalCount?: number;
}

export default function Sidebar({ className, onNavigate, pendingApprovalCount = 0 }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isMobile, setOpenMobile } = useSidebar();
  const { theme, toggleTheme } = useTheme();

  const { data: chats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });

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
                icon={<Activity size={15} strokeWidth={1.75} />}
                label="Activity"
                active={isActive('/activity')}
                onClick={() => go('/activity')}
                badge={pendingApprovalCount > 0 ? pendingApprovalCount : undefined}
              />
              <NavItem
                icon={<MessagesSquare size={15} strokeWidth={1.75} />}
                label="Chats"
                active={isActive('/chats')}
                onClick={() => go('/chats')}
              />
              <NavItem
                icon={<LayoutGrid size={15} strokeWidth={1.75} />}
                label="Projects"
                active={isActive('/projects')}
                onClick={() => go('/projects')}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {recentChats.length > 0 && (
          <SidebarGroup className="min-h-0 flex-1 pt-1">
            <SidebarGroupLabel className="h-6 px-2 text-[11px] font-semibold uppercase tracking-wide text-faint-fg">
              Recent
            </SidebarGroupLabel>
            <SidebarGroupContent className="min-h-0 flex-1">
              <div className="min-w-0 overflow-hidden">
                <ul className="flex w-full flex-col gap-0 pb-2 pr-1">
                  {recentChats.map(chat => (
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
                        <span className="block truncate text-xs font-medium text-foreground">
                          {chat.title ?? 'Untitled chat'}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-faint-fg">
                          {timeAgo(chat.updated_at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {recentChats.length === 0 && <div className="flex-1" />}
      </SidebarContent>

      {/* ---- Footer: Settings + Theme toggle ---- */}
      <SidebarFooter className="border-t border-sidebar-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => go('/settings')}
            className={cn(
              'flex flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
              isActive('/settings') && 'bg-sidebar-accent text-foreground',
            )}
          >
            <Settings size={14} strokeWidth={1.75} />
            Settings
          </button>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-sidebar-border text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            {theme === 'unnamed-dark'
              ? <Sun size={14} strokeWidth={1.75} />
              : <Moon size={14} strokeWidth={1.75} />}
          </button>
        </div>
      </SidebarFooter>
    </SidebarRoot>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={onClick}
        className={cn(
          'h-9 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
          active && 'bg-sidebar-accent text-foreground shadow-xs ring-1 ring-sidebar-border/60',
        )}
      >
        {icon}
        <span className="flex-1">{label}</span>
        {badge != null && (
          <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-amber-900">
            {badge}
          </span>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
