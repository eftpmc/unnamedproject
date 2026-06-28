import { useEffect, useRef, useState } from 'react';
import { Outlet, useParams, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AppSidebar from '../components/Sidebar.js';
import AppHeader from '../components/AppHeader.js';
import ChatView from '../components/ChatView.js';
import EmptyState from '../components/EmptyState.js';
import InboxPanel from '../components/InboxPanel.js';
import ErrorBoundary from '../components/ErrorBoundary.js';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getAgentProviders } from '../lib/api.js';
import { connect, disconnect, subscribe } from '../lib/ws.js';
import type { AgentProvider, Session, WSApprovalRequested, WSExecutionUpdate, WSTurnComplete } from '../types.js';

const PAGE_ROUTES = ['/home', '/chats', '/projects', '/documents', '/media', '/triggers', '/settings'];

export default function AppLayout() {
  const { chatId } = useParams<{ chatId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<Map<string, string>>(new Map());
  const [inboxOpen, setInboxOpen] = useState(false);

  const chatIdRef = useRef(chatId);
  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);


  const { data: agentProviders = [] } = useQuery<AgentProvider[]>({ queryKey: ['agent-providers'], queryFn: getAgentProviders, staleTime: 60_000 });
  const hasLeadAgent = agentProviders.length > 0;

  useEffect(() => {
    connect();
    const unsub = subscribe(event => {
      if (event.type === 'approval_requested') {
        const e = event as unknown as WSApprovalRequested;
        setPendingApprovals(prev => new Map(prev).set(e.executionId, e.approvalId));
        if ('Notification' in window) {
          const isCurrentChat = e.sessionId ? chatIdRef.current === e.sessionId : false;
          if (!isCurrentChat || document.visibilityState !== 'visible') {
            const label = e.action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const fire = () => {
              const n = new Notification('Approval needed', { body: label, icon: '/favicon.ico', tag: `approval-${e.executionId}`, requireInteraction: true });
              if (e.sessionId) n.onclick = () => { window.focus(); navigate(`/c/${e.sessionId}`); };
            };
            if (Notification.permission === 'granted') fire();
            else if (Notification.permission === 'default') Notification.requestPermission().then(p => { if (p === 'granted') fire(); });
          }
        }
      } else if (event.type === 'execution_update') {
        const e = event as unknown as WSExecutionUpdate;
        if (e.status === 'running' || e.status === 'done' || e.status === 'error') {
          setPendingApprovals(prev => { const next = new Map(prev); next.delete(e.executionId); return next; });
        }
      } else if (event.type === 'turn_complete') {
        const e = event as unknown as WSTurnComplete;
        if (e.status === 'done' && 'Notification' in window) {
          const isCurrentChat = chatIdRef.current === e.sessionId;
          if (!isCurrentChat || document.visibilityState !== 'visible') {
            const chats = queryClient.getQueryData<Session[]>(['chats']);
            const title = chats?.find(c => c.id === e.sessionId)?.title ?? 'Agent finished';
            const fire = () => new Notification('unnamed', { body: title, icon: '/favicon.ico', tag: e.sessionId });
            if (Notification.permission === 'granted') fire();
            else if (Notification.permission === 'default') Notification.requestPermission().then(p => { if (p === 'granted') fire(); });
          }
        }
      }
    });
    return () => { unsub(); disconnect(); };
  }, [queryClient, navigate]);

  function handleApprovalResolved(executionId: string) {
    setPendingApprovals(prev => { const next = new Map(prev); next.delete(executionId); return next; });
  }

  const isPageRoute = PAGE_ROUTES.some(r => location.pathname === r || location.pathname.startsWith(r + '/'));
  const mainContent = isPageRoute
    ? <Outlet />
    : chatId
      ? <ChatView chatId={chatId} />
      : <EmptyState hasLeadAgent={hasLeadAgent} />;

  return (
    <div className="relative flex h-screen overflow-hidden bg-background text-foreground">
      <div className="hidden sm:block">
        <AppSidebar pinned={sidebarPinned} onTogglePin={() => setSidebarPinned(v => !v)} />
      </div>

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-72 max-w-[85vw] gap-0 p-0" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Main app navigation</SheetDescription>
          </SheetHeader>
          <AppSidebar
            pinned
            mobile
            onTogglePin={() => undefined}
            onNavigate={() => setMobileSidebarOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Content reserves the collapsed sidebar gutter; expanded sidebar overlays it. */}
      <div className="flex min-w-0 flex-1 flex-col sm:pl-12">
        <AppHeader
          pendingApprovalCount={pendingApprovals.size}
          onOpenInbox={() => setInboxOpen(true)}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
        />

        <main className="flex min-h-0 flex-1 flex-col overflow-auto">
          <ErrorBoundary key={location.pathname}>
            {mainContent}
          </ErrorBoundary>
        </main>
      </div>

      <InboxPanel
        open={inboxOpen}
        onOpenChange={setInboxOpen}
        pendingApprovals={pendingApprovals}
        onApprovalResolved={handleApprovalResolved}
      />
    </div>
  );
}
