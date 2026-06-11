import { useState, useEffect } from 'react';
import { Outlet, useParams, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import IconRail from '../components/IconRail.js';
import NavPanel from '../components/NavPanel.js';
import SessionView from '../components/SessionView.js';
import EmptyState from '../components/EmptyState.js';
import { getSessions, createSession } from '../lib/api.js';
import { connect } from '../lib/ws.js';

export default function AppLayout() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const isSettings = location.pathname === '/settings';

  const [activePanel, setActivePanel] = useState<'sessions' | 'projects'>('sessions');
  const showPanel = !isSettings;

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: getSessions,
  });

  useEffect(() => {
    connect();
  }, []);

  function handlePanelToggle(panel: 'sessions' | 'projects') {
    setActivePanel(panel);
  }

  async function handleNewSession() {
    const { id } = await createSession();
    await refetchSessions();
    navigate(`/s/${id}`);
  }

  const mainContent = isSettings
    ? <Outlet />
    : sessionId
      ? <SessionView sessionId={sessionId} />
      : <EmptyState onNewSession={handleNewSession} />;

  return (
    <div className="flex h-full gap-2 bg-muted/45 p-3 text-foreground">
      <IconRail
        activePanel={showPanel ? activePanel : null}
        onPanelToggle={handlePanelToggle}
      />
      {showPanel && (
        <NavPanel
          activePanel={activePanel}
          sessions={sessions}
          activeSessionId={sessionId}
          onNewSession={handleNewSession}
        />
      )}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl bg-background/58 shadow-sm backdrop-blur">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
        {mainContent}
      </main>
    </div>
  );
}
