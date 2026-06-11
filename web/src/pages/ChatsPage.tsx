import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { getChats, deleteChat } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chats'] }),
  });

  if (isLoading) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center px-6">
        <h1 className="text-sm font-medium">Chats</h1>
      </header>

      {chats.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground/60">No chats yet. Start a new one.</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="px-6 pb-6">
            <div className="divide-y divide-border/50 rounded-2xl border border-border/50 bg-background/40">
              {chats.map(chat => (
                <div key={chat.id} className="flex items-center gap-3 px-4 py-3">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => navigate(`/c/${chat.id}`)}
                  >
                    <div className="truncate text-sm font-medium">{chat.title ?? 'Untitled chat'}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{timeAgo(chat.updated_at)}</div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
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
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
