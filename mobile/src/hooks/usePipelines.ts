import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Pipeline } from '../../types';

export function usePipelines() {
  return useQuery<Pipeline[]>({
    queryKey: ['pipelines'],
    queryFn: () => apiFetch('/pipelines'),
  });
}
