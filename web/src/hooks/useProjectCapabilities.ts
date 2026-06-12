import { useQuery } from '@tanstack/react-query';
import { getProjectCapabilities } from '../lib/api.js';
import StudioTab from '../components/StudioTab.js';
import type { Project } from '../types.js';
import type { ComponentType } from 'react';

export interface CapabilityTab {
  id: string;
  label: string;
  component: ComponentType<{ project: Project }>;
}

export function useProjectCapabilities(projectId: string) {
  const { data, isLoading } = useQuery({
    queryKey: ['project-capabilities', projectId],
    queryFn: () => getProjectCapabilities(projectId),
    staleTime: 30_000,
  });

  const tabs: CapabilityTab[] = [];
  if (data?.has_remotion || data?.has_media) {
    tabs.push({ id: 'studio', label: 'Studio', component: StudioTab });
  }

  return { tabs, isLoaded: !isLoading };
}
