export const PROJECT_TYPES = ['default', 'video'] as const;

export type ProjectType = typeof PROJECT_TYPES[number];

export function isValidProjectType(type: string): type is ProjectType {
  return (PROJECT_TYPES as readonly string[]).includes(type);
}
