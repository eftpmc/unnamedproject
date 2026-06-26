export type FieldType = 'string' | 'number' | 'boolean' | 'enum';

export interface FieldDef {
  type: FieldType;
  required?: boolean;
  options?: string[];
}

export type ItemSchema = Record<string, FieldDef>;

const FIELD_TYPES = new Set<string>(['string', 'number', 'boolean', 'enum']);

export function validateSchema(schema: unknown): string | null {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return 'schema must be an object';
  }
  for (const [key, def] of Object.entries(schema as Record<string, unknown>)) {
    if (typeof def !== 'object' || def === null) return `schema.${key} must be an object`;
    const d = def as Record<string, unknown>;
    if (!FIELD_TYPES.has(d.type as string)) {
      return `schema.${key}.type must be one of: string, number, boolean, enum`;
    }
    if (d.type === 'enum') {
      if (!Array.isArray(d.options) || d.options.length === 0) {
        return `schema.${key}.options must be a non-empty array for enum fields`;
      }
    }
  }
  return null;
}

export function validateFields(fields: unknown, schema: ItemSchema): string | null {
  if (typeof fields !== 'object' || fields === null) return 'fields must be an object';
  const f = fields as Record<string, unknown>;
  for (const [key, def] of Object.entries(schema)) {
    const value = f[key];
    if (def.required && (value === undefined || value === null)) {
      return `fields.${key} is required`;
    }
    if (value === undefined || value === null) continue;
    switch (def.type) {
      case 'string':
        if (typeof value !== 'string') return `fields.${key} must be a string`;
        break;
      case 'number':
        if (typeof value !== 'number') return `fields.${key} must be a number`;
        break;
      case 'boolean':
        if (typeof value !== 'boolean') return `fields.${key} must be a boolean`;
        break;
      case 'enum':
        if (!def.options!.includes(value as string)) {
          return `fields.${key} must be one of: ${def.options!.join(', ')}`;
        }
        break;
    }
  }
  return null;
}
