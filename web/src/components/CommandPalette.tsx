import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { FileText, FolderOpen, Home, MessageSquare, Plus, Settings, Zap } from 'lucide-react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { searchChats, getProjects, getAllDocuments, createChat } from '../lib/api.js';
import type { Document, Project, Session } from '../types.js';

const Ctx = createContext<{ open: () => void } | null>(null);
export const useCommandPalette = () => useContext(Ctx)!;

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(v => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <PaletteModal open={isOpen} onOpenChange={setIsOpen} />
    </Ctx.Provider>
  );
}

function PaletteModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  useEffect(() => { if (!open) setQ(''); }, [open]);

  const trimmed = q.trim();

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => getProjects(),
    enabled: open,
    staleTime: 30_000,
  });

  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ['documents-global'],
    queryFn: () => getAllDocuments(),
    enabled: open,
    staleTime: 30_000,
  });

  const { data: chatResults = [] } = useQuery<Session[]>({
    queryKey: ['palette-search', trimmed],
    queryFn: () => searchChats(trimmed),
    enabled: open && trimmed.length > 1,
    staleTime: 10_000,
  });

  const lq = trimmed.toLowerCase();
  const filteredProjects = trimmed ? projects.filter(p => p.name.toLowerCase().includes(lq)).slice(0, 5) : [];
  const filteredDocs: Document[] = trimmed ? documents.filter((d: Document) => d.title.toLowerCase().includes(lq)).slice(0, 5) : [];

  const newChatMutation = useMutation({
    mutationFn: () => createChat(),
    onSuccess: ({ id }) => { navigate(`/c/${id}`); onOpenChange(false); },
  });

  function run(fn: () => void) { fn(); onOpenChange(false); }

  const searching = trimmed.length > 1;
  const hasResults = chatResults.length > 0 || filteredProjects.length > 0 || filteredDocs.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search chats, projects, and documents">
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search chats, projects, docs..." value={q} onValueChange={setQ} />
        <CommandList>
          {searching ? (
            <>
              {!hasResults && <CommandEmpty>No results for &ldquo;{trimmed}&rdquo;</CommandEmpty>}
              {chatResults.length > 0 && (
                <CommandGroup heading="Chats">
                  {chatResults.slice(0, 6).map(chat => (
                    <CommandItem key={chat.id} value={`chat-${chat.id}`} onSelect={() => run(() => navigate(`/c/${chat.id}`))}>
                      <MessageSquare className="text-muted-foreground" />
                      <span className="truncate">{chat.title ?? 'Untitled chat'}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {filteredProjects.length > 0 && (
                <CommandGroup heading="Projects">
                  {filteredProjects.map(p => (
                    <CommandItem key={p.id} value={`project-${p.id}`} onSelect={() => run(() => navigate(`/projects/${p.id}`))}>
                      <FolderOpen className="text-muted-foreground" />
                      <span className="truncate">{p.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {filteredDocs.length > 0 && (
                <CommandGroup heading="Documents">
                  {filteredDocs.map(doc => (
                    <CommandItem key={doc.id} value={`doc-${doc.id}`} onSelect={() => run(() => navigate(`/documents/${doc.id}`))}>
                      <FileText className="text-muted-foreground" />
                      <span className="truncate">{doc.title}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </>
          ) : (
            <>
              <CommandGroup heading="Actions">
                <CommandItem value="new-chat" onSelect={() => newChatMutation.mutate()}>
                  <Plus className="text-muted-foreground" />
                  New chat
                </CommandItem>
                <CommandItem value="new-document" onSelect={() => run(() => navigate('/documents', { state: { openNew: true } }))}>
                  <FileText className="text-muted-foreground" />
                  New document
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Go to">
                <CommandItem value="go-home" onSelect={() => run(() => navigate('/home'))}>
                  <Home className="text-muted-foreground" />
                  Home
                </CommandItem>
                <CommandItem value="go-projects" onSelect={() => run(() => navigate('/projects'))}>
                  <FolderOpen className="text-muted-foreground" />
                  Projects
                </CommandItem>
                <CommandItem value="go-chats" onSelect={() => run(() => navigate('/chats'))}>
                  <MessageSquare className="text-muted-foreground" />
                  Chats
                </CommandItem>
                <CommandItem value="go-documents" onSelect={() => run(() => navigate('/documents'))}>
                  <FileText className="text-muted-foreground" />
                  Documents
                </CommandItem>
                <CommandItem value="go-triggers" onSelect={() => run(() => navigate('/triggers'))}>
                  <Zap className="text-muted-foreground" />
                  Triggers
                </CommandItem>
                <CommandItem value="go-settings" onSelect={() => run(() => navigate('/settings'))}>
                  <Settings className="text-muted-foreground" />
                  Settings
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
