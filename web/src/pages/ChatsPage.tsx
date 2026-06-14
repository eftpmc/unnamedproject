import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Trash2, X } from 'lucide-react';
import { getChats, deleteChat, searchChats } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CenteredEmptyState, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { Session } from '../types.js';
import { useDebounce } from '../lib/useDebounce.js';

export default function ChatsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounce(searchQuery, 300);

  const { data: chats = [], isLoading } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });

  const { data: searchResults, isFetching: isSearching } = useQuery<Session[]>({
    queryKey: ['chats-search', debouncedQuery],
    queryFn: () => searchChats(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
    staleTime: 10_000,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteChat,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chats-search'] });
      setPendingDelete(null);
    },
    onError: () => setPendingDelete(null),
  });

  const isSearchActive = debouncedQuery.length >= 2;
  const displayedChats = isSearchActive ? (searchResults ?? []) : chats;

  return (
    <PageShell>
      <PageHeader title="Chats" />

      <div className="shrink-0 px-6 pb-3 pt-1">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search chats…"
            className="pl-8 pr-8 h-8 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <PageLoading rows={5} />
      ) : displayedChats.length === 0 ? (
        <CenteredEmptyState
          title={isSearchActive ? 'No results' : 'No chats yet'}
          description={isSearchActive ? `Nothing matched "${debouncedQuery}".` : 'Start a conversation to plan work, inspect a project, or make a change.'}
        />
      ) : (
        <ScrollArea className="flex-1">
          <div className="px-6 py-3">
            {isSearchActive && (
              <p className="mb-2 text-xs text-muted-foreground">
                {isSearching ? 'Searching…' : `${displayedChats.length} result${displayedChats.length !== 1 ? 's' : ''}`}
              </p>
            )}
            <div className="divide-y divide-border/50 rounded-lg border border-border/50 bg-background/40">
              {displayedChats.map(chat => (
                <div key={chat.id} className="flex items-center gap-3 px-4 py-3">
                  <button
                    aria-label={`Open chat ${chat.title ?? 'Untitled chat'}, updated ${timeAgo(chat.updated_at)}`}
                    className="min-w-0 flex-1 text-left"
                    onClick={() => navigate(`/c/${chat.id}`)}
                  >
                    <div className="truncate text-sm font-medium">{chat.title ?? 'Untitled chat'}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{timeAgo(chat.updated_at)}</div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete chat ${chat.title ?? 'Untitled chat'}`}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingDelete(chat.id)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete chat?"
          description="This will permanently delete the chat and all its messages."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </PageShell>
  );
}
