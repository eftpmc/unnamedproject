import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { PendingApproval } from '../../types';

export function useActivity() {
  return useQuery<PendingApproval[]>({
    queryKey: ['activity'],
    queryFn: () => apiFetch('/executions/pending-approvals'),
  });
}

export function useApproveExecution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/executions/${id}/approve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity'] }),
  });
}

export function useRejectExecution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/executions/${id}/reject`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity'] }),
  });
}
