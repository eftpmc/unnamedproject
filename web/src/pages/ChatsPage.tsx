import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { getChats, deleteChat } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CenteredEmptyState, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { Session } from '../types.js';

export default function ChatsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const { data: chats = [], isLoading } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteChat,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setPendingDelete(null);
    },
    onError: () => setPendingDelete(null),
  });

  return (
    <PageShell>
      <PageHeader title="Chats" />

      {isLoading ? (
        <PageLoading rows={5} />
      ) : chats.length === 0 ? (
        <CenteredEmptyState
          title="No chats yet"
          description="Start a conversation to plan work, inspect a project, or make a change."
        />
      ) : (
        <ScrollArea className="flex-1">
          <div className="px-6 py-6">
            <div className="divide-y divide-border/50 rounded-xl border border-border/50 bg-background/40">
              {chats.map(chat => (
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
                    aria-label={`Delete chat ${chat.title ?? 'Untitled chat'}, updated ${timeAgo(chat.updated_at)}`}
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
          onConfirm={() => {
            deleteMutation.mutate(pendingDelete);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </PageShell>
  );
}
