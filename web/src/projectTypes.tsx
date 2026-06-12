import type { ComponentType } from 'react';
import type { Project } from './types.js';

export interface ProjectTabDef {
  id: string;
  label: string;
  component: ComponentType<{ project: Project }>;
}

export interface ProjectTypeConfig {
  /** Tabs appended after the base "files" tab, before "settings". */
  extraTabs: ProjectTabDef[];
}

export const PROJECT_TYPE_REGISTRY: Record<string, ProjectTypeConfig> = {
  default: {
    extraTabs: [],
  },
};

export function getProjectTypeConfig(type: string): ProjectTypeConfig {
  return PROJECT_TYPE_REGISTRY[type] ?? PROJECT_TYPE_REGISTRY.default;
}
