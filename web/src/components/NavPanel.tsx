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
    <div className="w-45 bg-base-200 border-r border-[#151515] flex flex-col overflow-hidden shrink-0">
      {activePanel === 'sessions' ? (
        <>
          <div className="px-3 pt-2.5 pb-1.5 text-[#444444] text-[9px] uppercase tracking-wider flex items-center justify-between">
            Sessions
            <button
              onClick={onNewSession}
              title="New session"
              className="btn btn-ghost btn-xs btn-square text-[#444444] text-sm leading-none p-0 min-h-0 h-auto"
            >
              +
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sessions.length === 0 && (
              <div className="p-3 text-[#333333] text-[10px]">No sessions yet</div>
            )}
            {sessions.map(s => {
              const active = s.id === activeSessionId;
              return (
                <div
                  key={s.id}
                  onClick={() => navigate(`/s/${s.id}`)}
                  className={`py-1.5 px-3 cursor-pointer border-l-2 ${active ? 'bg-[#161616] border-l-base-content pl-2.5' : 'border-l-transparent hover:bg-base-300'}`}
                >
                  <div className={`text-[10px] truncate ${active ? 'text-[#dddddd] font-medium' : 'text-[#666666]'}`}>
                    {s.title ?? 'Untitled session'}
                  </div>
                  <div className="text-[#333333] text-[9px] mt-0.5">
                    {timeAgo(s.updated_at)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="px-3 pt-2.5 pb-1.5 text-[#444444] text-[9px] uppercase tracking-wider">
            Workspaces
          </div>
          <div className="flex-1 overflow-y-auto">
            {workspaces.map(w => (
              <div key={w.id} className="py-1.5 px-3">
                <div className="text-[#666666] text-[10px] truncate">
                  {w.name}
                </div>
                {w.description && (
                  <div className="text-[#333333] text-[9px] mt-0.5 truncate">
                    {w.description}
                  </div>
                )}
              </div>
            ))}
            {workspaces.length > 0 && connections.length > 0 && (
              <div className="border-t border-[#141414] mt-1">
                <div className="px-3 pt-2 pb-1 text-[#333333] text-[9px] uppercase tracking-wider">
                  Connections
                </div>
                {connections.map(c => (
                  <div key={c.id} className="py-1 px-3 flex items-center gap-1.5">
                    <div className="text-[#555555] text-[10px] flex-1 truncate">
                      {c.name}
                    </div>
                    <div className="text-[#333333] text-[9px]">{c.type}</div>
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
