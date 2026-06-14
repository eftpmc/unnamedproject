import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Search, Trash2, X } from 'lucide-react';
import { getChats, deleteChat, searchChats } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { ContentColumn, EmptyPanel, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
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

      {isLoading ? (
        <PageLoading rows={5} />
      ) : (
        <PageBody>
          <ContentColumn className="max-w-2xl">
            <div className="relative mb-5">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint-fg pointer-events-none" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search chats…"
                className="w-full rounded-lg border border-border-soft bg-card py-2 pl-8 pr-8 text-sm text-foreground placeholder:text-faint-fg focus:border-border focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint-fg hover:text-muted-foreground transition-colors"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {isSearchActive && (
              <p className="mb-3 text-xs text-muted-foreground">
                {isSearching ? 'Searching…' : `${displayedChats.length} result${displayedChats.length !== 1 ? 's' : ''}`}
              </p>
            )}

            {displayedChats.length === 0 ? (
              <EmptyPanel
                title={isSearchActive ? 'No results' : 'No chats yet'}
                description={isSearchActive
                  ? `Nothing matched "${debouncedQuery}".`
                  : 'Start a conversation to plan work, inspect a project, or make a change.'}
              />
            ) : (
              <div className="flex flex-col gap-2">
                {displayedChats.map(chat => (
                  <div
                    key={chat.id}
                    className="group flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3.5 transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-border hover:shadow-sm"
                  >
                    <button
                      type="button"
                      aria-label={`Open chat: ${chat.title ?? 'Untitled chat'}`}
                      className="min-w-0 flex-1 text-left"
                      onClick={() => navigate(`/c/${chat.id}`)}
                    >
                      <div className="truncate text-sm font-medium text-foreground">
                        {chat.title ?? 'Untitled chat'}
                      </div>
                      <div className="mt-0.5 text-xs text-faint-fg">{timeAgo(chat.updated_at)}</div>
                    </button>
                    <ChevronRight
                      size={15}
                      className="shrink-0 text-faint-fg transition-colors group-hover:text-muted-foreground"
                      onClick={() => navigate(`/c/${chat.id}`)}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete chat: ${chat.title ?? 'Untitled chat'}`}
                      className="shrink-0 text-faint-fg opacity-0 transition-[opacity,color] hover:text-destructive group-hover:opacity-100"
                      onClick={() => setPendingDelete(chat.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ContentColumn>
        </PageBody>
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
