import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getWorkspaces, getConnections } from '../lib/api.js';
import type { Session, Workspace, Connection } from '../types.js';

function timeAgo(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

interface NavPanelProps {
  activePanel: 'sessions' | 'workspaces';
  sessions: Session[];
  activeSesssionId?: string;
  onNewSession: () => void;
}

export default function NavPanel({ activePanel, sessions, activeSesssionId, onNewSession }: NavPanelProps) {
  const navigate = useNavigate();

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: getWorkspaces,
    enabled: activePanel === 'workspaces',
  });

  const { data: connections = [] } = useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: getConnections,
    enabled: activePanel === 'workspaces',
  });

  return (
    <div style={{
      width: 180,
      background: '#0d0d0d',
      borderRight: '1px solid #151515',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {activePanel === 'sessions' ? (
        <>
          <div style={{
            padding: '10px 12px 6px',
            color: '#444',
            fontSize: 9,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            Sessions
            <button
              onClick={onNewSession}
              title="New session"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#444', fontSize: 14, lineHeight: 1 }}
            >
              +
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {sessions.length === 0 && (
              <div style={{ padding: '12px', color: '#333', fontSize: 10 }}>No sessions yet</div>
            )}
            {sessions.map(s => {
              const active = s.id === activeSesssionId;
              return (
                <div
                  key={s.id}
                  onClick={() => navigate(`/s/${s.id}`)}
                  style={{
                    padding: '7px 12px',
                    cursor: 'pointer',
                    background: active ? '#161616' : 'transparent',
                    borderLeft: active ? '2px solid #cccccc' : '2px solid transparent',
                    paddingLeft: active ? 10 : 12,
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = '#111'; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <div style={{
                    color: active ? '#dddddd' : '#666666',
                    fontSize: 10,
                    fontWeight: active ? 500 : 400,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {s.title ?? 'Untitled session'}
                  </div>
                  <div style={{ color: '#333', fontSize: 9, marginTop: 2 }}>
                    {timeAgo(s.updated_at)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div style={{ padding: '10px 12px 6px', color: '#444', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Workspaces
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {workspaces.map(w => (
              <div key={w.id} style={{ padding: '7px 12px' }}>
                <div style={{ color: '#666', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {w.name}
                </div>
                {w.description && (
                  <div style={{ color: '#333', fontSize: 9, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {w.description}
                  </div>
                )}
              </div>
            ))}
            {workspaces.length > 0 && connections.length > 0 && (
              <div style={{ borderTop: '1px solid #141414', marginTop: 4 }}>
                <div style={{ padding: '8px 12px 4px', color: '#333', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Connections
                </div>
                {connections.map(c => (
                  <div key={c.id} style={{ padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ color: '#555', fontSize: 10, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.name}
                    </div>
                    <div style={{ color: '#333', fontSize: 9 }}>{c.type}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
