import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { getProjects, getConnections } from '../lib/api.js';
import type { Session, Project, Connection } from '../types.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

function timeAgo(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

function connectionLabel(connection: Connection): string {
  switch (connection.purpose) {
    case 'lead_agent': return 'Lead agent';
    case 'claude_code': return 'Claude Code';
    case 'codex': return 'Codex';
    case 'github': return 'GitHub';
    case 'mcp': return 'MCP';
    case 'tool': return connection.type;
  }
}

interface NavPanelProps {
  activePanel: 'sessions' | 'projects';
  sessions: Session[];
  activeSessionId?: string;
  onNewSession: () => void;
}

export default function NavPanel({ activePanel, sessions, activeSessionId, onNewSession }: NavPanelProps) {
  const navigate = useNavigate();

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
    enabled: activePanel === 'projects',
  });

  const { data: connections = [] } = useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: getConnections,
    enabled: activePanel === 'projects',
  });

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-3xl bg-background/50 backdrop-blur">
      {activePanel === 'sessions' ? (
        <>
          <div className="flex items-center justify-between px-4 py-4">
            <div>
              <div className="text-sm font-medium">Sessions</div>
              <div className="text-xs text-muted-foreground">{sessions.length} total</div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onNewSession}
              title="New session"
              className="rounded-xl text-muted-foreground hover:text-foreground"
            >
              <Plus size={16} strokeWidth={1.75} />
            </Button>
          </div>
          <Separator className="mx-4 w-auto bg-border/60" />
          <ScrollArea className="flex-1">
            <div className="p-2.5">
            {sessions.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border/70 bg-background/45 p-4 text-sm text-muted-foreground">No sessions yet</div>
            )}
            {sessions.map(s => {
              const active = s.id === activeSessionId;
              return (
                <button
                  key={s.id}
                  onClick={() => navigate(`/s/${s.id}`)}
                  className={cn(
                    'mb-1 w-full rounded-2xl px-3 py-2.5 text-left transition-colors',
                    active ? 'bg-background text-foreground shadow-xs ring-1 ring-border/60' : 'text-muted-foreground hover:bg-background/65 hover:text-foreground',
                  )}
                >
                  <div className="truncate text-sm font-medium">
                    {s.title ?? 'Untitled session'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {timeAgo(s.updated_at)}
                  </div>
                </button>
              );
            })}
            </div>
          </ScrollArea>
        </>
      ) : (
        <>
          <div className="px-4 py-4">
            <div className="text-sm font-medium">Projects</div>
            <div className="text-xs text-muted-foreground">{projects.length} total</div>
          </div>
          <Separator className="mx-4 w-auto bg-border/60" />
          <ScrollArea className="flex-1">
            <div className="p-2.5">
            {projects.map(p => (
              <div key={p.id} className="rounded-2xl px-3 py-2.5 hover:bg-background/65">
                <div className="truncate text-sm font-medium">
                  {p.name}
                  {!p.repo_path && <span className="ml-2 text-xs text-muted-foreground">(no repo)</span>}
                </div>
                {p.description && (
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {p.description}
                  </div>
                )}
              </div>
            ))}
            {projects.length > 0 && connections.length > 0 && (
              <div className="mt-3 space-y-1 border-t border-border/60 pt-3">
                <div className="px-3 pb-1 text-xs font-medium text-muted-foreground">Setup</div>
                {connections.map(c => (
                  <div key={c.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5">
                    <div className="flex-1 truncate text-sm text-muted-foreground">{c.name}</div>
                    <Badge variant="secondary">{connectionLabel(c)}</Badge>
                  </div>
                ))}
              </div>
            )}
            </div>
          </ScrollArea>
        </>
      )}
    </aside>
  );
}
