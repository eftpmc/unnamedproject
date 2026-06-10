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

  const [activePanel, setActivePanel] = useState<'sessions' | 'workspaces'>('sessions');
  const showPanel = !isSettings;

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: getSessions,
  });

  useEffect(() => {
    connect();
  }, []);

  function handlePanelToggle(panel: 'sessions' | 'workspaces') {
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
    <div style={{ display: 'flex', height: '100%', background: '#0a0a0a' }}>
      <IconRail
        activePanel={showPanel ? activePanel : null}
        onPanelToggle={handlePanelToggle}
      />
      {showPanel && (
        <NavPanel
          activePanel={activePanel}
          sessions={sessions}
          activeSesssionId={sessionId}
          onNewSession={handleNewSession}
        />
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {mainContent}
      </div>
    </div>
  );
}
