import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, uploadMessage } from '../lib/api';
import type { Message } from '../../types';

export function useMessages(chatId: string) {
  return useQuery<Message[]>({
    queryKey: ['messages', chatId],
    queryFn: () => apiFetch(`/sessions/${chatId}/messages`),
    enabled: !!chatId,
  });
}

export function useSendMessage(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      content,
      attachments = [],
    }: {
      content: string;
      attachments?: Array<{ uri: string; name: string; type: string }>;
    }) =>
      attachments.length > 0
        ? uploadMessage(chatId, content, attachments)
        : apiFetch(`/sessions/${chatId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content }),
          }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', chatId] }),
  });
}
