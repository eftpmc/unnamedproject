import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, MessagesSquare, Plus, Search, Settings } from 'lucide-react';
import { createChat, getChats, getProjects, searchChats } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import type { Project, Session } from '../types.js';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface Item {
  id: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  action: () => void | Promise<void>;
}

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function match(query: string, text: string): boolean {
  const q = normalize(query);
  const t = normalize(text);
  if (!q) return true;
  // consecutive character subsequence match (fuzzy)
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [searchResults, setSearchResults] = useState<Session[]>([]);

  const { data: chats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
    enabled: open,
  });
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
    staleTime: 60_000,
    enabled: open,
  });

  // Debounced full-text search against message content
  useEffect(() => {
    if (query.length < 3) { setSearchResults([]); return; }
    const timer = setTimeout(() => {
      searchChats(query).then(setSearchResults).catch(() => setSearchResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  function go(path: string) {
    navigate(path);
    onClose();
  }

  const staticItems: Item[] = [
    {
      id: '__new_chat',
      label: 'New chat',
      icon: <Plus size={14} />,
      action: async () => {
        const { id } = await createChat();
        await queryClient.invalidateQueries({ queryKey: ['chats'] });
        go(`/c/${id}`);
      },
    },
    {
      id: '__settings',
      label: 'Settings',
      icon: <Settings size={14} />,
      action: () => go('/settings'),
    },
  ];

  const chatItems: Item[] = chats
    .filter(c => match(query, c.title ?? 'Untitled chat'))
    .slice(0, 8)
    .map(c => ({
      id: c.id,
      label: c.title ?? 'Untitled chat',
      sub: 'Chat',
      icon: <MessagesSquare size={14} />,
      action: () => go(`/c/${c.id}`),
    }));

  const projectItems: Item[] = projects
    .filter(p => match(query, p.name))
    .slice(0, 5)
    .map(p => ({
      id: p.id,
      label: p.name,
      sub: 'Project',
      icon: <FolderOpen size={14} />,
      action: () => go(`/projects/${p.id}`),
    }));

  const chatItemIds = new Set(chatItems.map(i => i.id));
  const messageMatchItems: Item[] = searchResults
    .filter(s => !chatItemIds.has(s.id))
    .slice(0, 5)
    .map(s => ({
      id: `msg-${s.id}`,
      label: s.title ?? 'Untitled chat',
      sub: 'Message match',
      icon: <Search size={14} />,
      action: () => go(`/c/${s.id}`),
    }));

  const filteredStatics = staticItems.filter(i => !query || match(query, i.label));
  const items: Item[] = [...filteredStatics, ...chatItems, ...projectItems, ...messageMatchItems];

  // Reset state on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setSearchResults([]);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // Keep active index in bounds when items change
  useEffect(() => {
    setActiveIdx(idx => Math.min(idx, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[activeIdx]?.action();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* backdrop */}
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />

      <div className="relative z-10 w-full max-w-[30rem] mx-4 overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/20">
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
          onKeyDown={handleKeyDown}
          placeholder="Search chats, projects, or actions…"
          className="w-full border-b border-border-soft bg-transparent px-4 py-3.5 text-sm text-foreground placeholder:text-faint-fg focus:outline-none"
        />

        {items.length > 0 ? (
          <div ref={listRef} className="max-h-72 overflow-y-auto py-1.5">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => item.action()}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                  i === activeIdx
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground hover:bg-accent/50',
                )}
              >
                <span className={cn('shrink-0', i === activeIdx ? 'text-accent-foreground' : 'text-muted-foreground')}>
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.sub && (
                  <span className="shrink-0 text-[11px] text-faint-fg">{item.sub}</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No results for <span className="font-medium text-foreground">"{query}"</span>
          </div>
        )}

        <div className="border-t border-border-soft px-4 py-2 flex items-center gap-3 text-[11px] text-faint-fg">
          <span><kbd className="font-sans">↑↓</kbd> navigate</span>
          <span><kbd className="font-sans">↵</kbd> open</span>
          <span><kbd className="font-sans">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
