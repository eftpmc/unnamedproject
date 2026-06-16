import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Project, Campaign, Artifact } from '../../types';

export interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  path: string;
}

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => apiFetch('/projects'),
  });
}

export function useProject(id: string) {
  return useQuery<{ capabilities: string[] }>({
    queryKey: ['project', id],
    queryFn: () => apiFetch<{ capabilities: string[] }>(`/projects/${id}/capabilities`),
    enabled: !!id,
  });
}

export function useProjectCampaigns(id: string) {
  return useQuery<Campaign[]>({
    queryKey: ['project-campaigns', id],
    queryFn: () => apiFetch(`/projects/${id}/campaigns`),
    enabled: !!id,
  });
}

export function useArtifacts(id: string) {
  return useQuery<Artifact[]>({
    queryKey: ['artifacts', id],
    queryFn: () => apiFetch(`/projects/${id}/artifacts`),
    enabled: !!id,
  });
}

export function useProjectTree(id: string, dirPath = '', enabled = true) {
  return useQuery<{ entries: FileEntry[]; base_is_repo?: boolean }>({
    queryKey: ['project-tree', id, dirPath],
    queryFn: () => apiFetch(`/projects/${id}/tree?path=${encodeURIComponent(dirPath)}`),
    enabled: !!id && enabled,
    staleTime: 30_000,
  });
}

export function useProjectFile(id: string, filePath: string | null) {
  return useQuery<{ content: string; path: string }>({
    queryKey: ['project-file', id, filePath],
    queryFn: () => apiFetch(`/projects/${id}/file?path=${encodeURIComponent(filePath!)}`),
    enabled: !!id && !!filePath,
    staleTime: 10_000,
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { description?: string }) =>
      apiFetch(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}
