import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Project, Campaign, Artifact } from '../../types';

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
