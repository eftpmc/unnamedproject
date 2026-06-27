import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  KeyRound,
  LayoutGrid,
  MessagesSquare,
  Plus,
} from 'lucide-react';
import { createChat, getActiveSessions, getChats, getSpaces } from '../lib/api.js';
import { cn, timeAgo } from '../lib/utils.js';
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
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import type { Session, Space } from '../types.js';

const RECENT_COUNT = 5;

interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
  pendingApprovalCount?: number;
  onOpenInbox?: () => void;
  hasLeadAgent?: boolean;
}

export default function Sidebar({
  className,
  onNavigate,
  pendingApprovalCount = 0,
  onOpenInbox,
  hasLeadAgent = true,
}: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isMobile, setOpenMobile } = useSidebar();
  const wsStatus = useWsStatus();

  const { data: chats = [] } = useQuery<Session[]>({ queryKey: ['chats'], queryFn: () => getChats() });
  const { data: spaces = [] } = useQuery<Space[]>({
    queryKey: ['spaces'],
    queryFn: getSpaces,
    staleTime: 60_000,
  });
  const { data: activeData } = useQuery({
    queryKey: ['active-sessions'],
    queryFn: getActiveSessions,
    refetchInterval: 5_000,
    staleTime: 0,
  });

  const activeIds = new Set(activeData?.ids ?? []);
  const activeChatId = location.pathname.startsWith('/c/') ? location.pathname.split('/')[2] : null;
  const spaceById = Object.fromEntries(spaces.map(space => [space.id, space]));

  function closeSidebar() {
    onNavigate?.();
    if (isMobile) setOpenMobile(false);
  }

  function go(path: string) {
    navigate(path);
    closeSidebar();
  }

  async function handleNewChat() {
    const { id } = await createChat();
    await queryClient.invalidateQueries({ queryKey: ['chats'] });
    go(`/c/${id}`);
  }

  return (
    <SidebarRoot className={cn('border-r border-sidebar-border bg-sidebar', className)} collapsible="offcanvas">
      <SidebarHeader className="gap-3 px-3 py-3">
        <div className="flex h-9 items-center gap-2 px-1">
          <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground shadow-sm">
            u
          </div>
          <span className="text-sm font-semibold">unnamed</span>
        </div>
        <button
          type="button"
          onClick={handleNewChat}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-[filter,transform] hover:brightness-105 active:translate-y-px"
        >
          <Plus size={14} strokeWidth={2} />
          New chat
        </button>
      </SidebarHeader>

      <SidebarContent>
        <GlobalNavigation pathname={location.pathname} onNavigate={closeSidebar} />

        {chats.length > 0 && (
          <SidebarGroup className="min-h-0 flex-1 pt-1">
            <SidebarGroupLabel className="h-6 px-2 text-[11px] font-semibold text-faint-fg">Recent</SidebarGroupLabel>
            <SidebarGroupContent className="min-h-0 flex-1">
              <ul className="flex w-full flex-col gap-0 pb-2 pr-1">
                {chats.slice(0, RECENT_COUNT).map(chat => {
                  const space = chat.pinned_space_id ? spaceById[chat.pinned_space_id] : null;
                  return (
                    <li key={chat.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => go(`/c/${chat.id}`)}
                        className={cn(
                          'flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent',
                          activeChatId === chat.id && 'bg-sidebar-accent shadow-xs ring-1 ring-sidebar-border',
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          {activeIds.has(chat.id) && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />}
                          <span className="truncate text-xs font-medium text-foreground">{chat.title ?? 'Untitled chat'}</span>
                        </div>
                        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-faint-fg">
                          <span className="shrink-0">{timeAgo(chat.updated_at)}</span>
                          {space && <><span>·</span><span className="truncate">{space.name}</span></>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {chats.length === 0 && <div className="flex-1" />}
      </SidebarContent>

      {!hasLeadAgent && (
        <div className="mx-2 mb-2">
          <button
            type="button"
            onClick={() => go('/settings')}
            className="flex w-full items-center gap-2.5 rounded-lg border border-warning/35 bg-warning/[0.07] px-3 py-2.5 text-left transition-colors hover:bg-warning/[0.12]"
          >
            <KeyRound size={13} className="shrink-0 text-warning" />
            <div>
              <div className="text-xs font-medium text-foreground">API key needed</div>
              <div className="text-[11px] text-muted-foreground">Set up in Settings → Agents</div>
            </div>
          </button>
        </div>
      )}

      <SidebarFooter className="border-t border-sidebar-border px-2.5 py-2.5">
        {wsStatus === 'disconnected' && (
          <div className="mb-2 flex items-center gap-2 rounded-md bg-warning/10 px-2.5 py-1.5">
            <span className="size-1.5 animate-pulse rounded-full bg-warning" />
            <span className="text-[11px] font-medium text-warning">Reconnecting…</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenInbox}
            aria-label="Open inbox"
            className="relative grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Bell size={15} strokeWidth={1.75} />
            {pendingApprovalCount > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-0.5 text-[9px] font-semibold text-warning-foreground">
                {pendingApprovalCount}
              </span>
            )}
          </button>
          <div className="flex-1"><UserMenu /></div>
        </div>
      </SidebarFooter>
    </SidebarRoot>
  );
}

function GlobalNavigation({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  return (
    <SidebarGroup className="pb-1">
      <SidebarGroupContent>
        <SidebarMenu>
          <NavItem icon={<MessagesSquare />} label="Chats" href="/chats" active={pathname.startsWith('/chats')} onClick={onNavigate} />
          <NavItem icon={<LayoutGrid />} label="Spaces" href="/spaces" active={pathname.startsWith('/spaces')} onClick={onNavigate} />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function NavItem({
  icon,
  label,
  href,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        className={cn(
          'h-9 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground [&_svg]:size-[15px] [&_svg]:stroke-[1.75]',
          active && 'bg-sidebar-accent text-foreground shadow-xs ring-1 ring-sidebar-border/60',
        )}
      >
        <Link to={href} onClick={onClick}>
          {icon}
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
