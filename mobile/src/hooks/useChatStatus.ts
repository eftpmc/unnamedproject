import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { ChatStatus } from '../../types';

export function useChatStatus(chatId: string) {
  return useQuery<ChatStatus>({
    queryKey: ['chat-status', chatId],
    queryFn: () => apiFetch(`/sessions/${chatId}/status`),
    enabled: !!chatId,
    refetchInterval: (query) => (query.state.data?.active ? 3000 : false),
  });
}
