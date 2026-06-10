import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
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
  activeSessionId?: string;
  onNewSession: () => void;
}

export default function NavPanel({ activePanel, sessions, activeSessionId, onNewSession }: NavPanelProps) {
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
    <div className="w-64 bg-base-200 border-r border-base-300 flex flex-col overflow-hidden shrink-0">
      {activePanel === 'sessions' ? (
        <>
          <div className="px-4 pt-4 pb-2 text-base-content/40 text-xs uppercase tracking-wider flex items-center justify-between">
            Sessions
            <button
              onClick={onNewSession}
              title="New session"
              className="btn btn-ghost btn-sm btn-square text-base-content/40 hover:text-base-content/70"
            >
              <Plus size={16} strokeWidth={1.75} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {sessions.length === 0 && (
              <div className="p-3 text-base-content/30 text-sm">No sessions yet</div>
            )}
            {sessions.map(s => {
              const active = s.id === activeSessionId;
              return (
                <div
                  key={s.id}
                  onClick={() => navigate(`/s/${s.id}`)}
                  className={`py-2.5 px-3 mb-1 rounded-xl cursor-pointer ${active ? 'bg-base-300' : 'hover:bg-base-300/60'}`}
                >
                  <div className={`text-sm truncate ${active ? 'text-base-content font-medium' : 'text-base-content/60'}`}>
                    {s.title ?? 'Untitled session'}
                  </div>
                  <div className="text-base-content/30 text-xs mt-1">
                    {timeAgo(s.updated_at)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="px-4 pt-4 pb-2 text-base-content/40 text-xs uppercase tracking-wider">
            Workspaces
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {workspaces.map(w => (
              <div key={w.id} className="py-2.5 px-3 rounded-xl">
                <div className="text-base-content/70 text-sm truncate">
                  {w.name}
                </div>
                {w.description && (
                  <div className="text-base-content/30 text-xs mt-1 truncate">
                    {w.description}
                  </div>
                )}
              </div>
            ))}
            {workspaces.length > 0 && connections.length > 0 && (
              <div className="border-t border-base-300 mt-2 pt-2">
                <div className="px-3 pb-1 text-base-content/30 text-xs uppercase tracking-wider">
                  Connections
                </div>
                {connections.map(c => (
                  <div key={c.id} className="py-1.5 px-3 flex items-center gap-2">
                    <div className="text-base-content/60 text-sm flex-1 truncate">{c.name}</div>
                    <div className="text-base-content/30 text-xs">{c.type}</div>
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
