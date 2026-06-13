import { useEffect, useState, type CSSProperties } from 'react';
import { Outlet, useParams, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar.js';
import ChatView from '../components/ChatView.js';
import EmptyState from '../components/EmptyState.js';
import { createChat } from '../lib/api.js';
import { connect, subscribe } from '../lib/ws.js';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import type { WSApprovalRequested, WSExecutionUpdate } from '../types.js';

const PAGE_ROUTES = ['/chats', '/projects', '/settings', '/activity'];

export default function AppLayout() {
  const { chatId } = useParams<{ chatId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  // executionId → approvalId for pending approvals
  const [pendingApprovals, setPendingApprovals] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    connect();
    const unsub = subscribe(event => {
      if (event.type === 'approval_requested') {
        const e = event as unknown as WSApprovalRequested;
        setPendingApprovals(prev => new Map(prev).set(e.executionId, e.approvalId));
      } else if (event.type === 'execution_update') {
        const e = event as unknown as WSExecutionUpdate;
        if (e.status === 'done' || e.status === 'error') {
          setPendingApprovals(prev => {
            const next = new Map(prev);
            next.delete(e.executionId);
            return next;
          });
        }
      }
    });
    return unsub;
  }, []);

  async function handleNewChat() {
    const { id } = await createChat();
    navigate(`/c/${id}`);
  }

  const isPageRoute = PAGE_ROUTES.some(r => location.pathname === r || location.pathname.startsWith(r + '/'));

  const mainContent = isPageRoute
    ? <Outlet />
    : chatId
      ? <ChatView chatId={chatId} />
      : <EmptyState onNewChat={handleNewChat} />;

  return (
    <SidebarProvider
      className="h-full min-h-0 bg-muted/45 text-foreground"
      style={{ '--sidebar-width': '14rem' } as CSSProperties}
    >
      <Sidebar pendingApprovalCount={pendingApprovals.size} />
      <SidebarInset className="relative min-h-0 min-w-0 overflow-hidden bg-background/58 backdrop-blur">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/50 bg-background/70 px-4 backdrop-blur md:hidden">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground text-sm font-semibold text-background shadow-sm">
              u
            </div>
            <span className="text-sm font-semibold">unnamed</span>
          </div>
          <SidebarTrigger
            aria-label="Open navigation"
            className="size-9 rounded-xl border border-border/60 bg-background/80 text-foreground shadow-xs"
          />
        </div>
        {mainContent}
      </SidebarInset>
    </SidebarProvider>
  );
}
