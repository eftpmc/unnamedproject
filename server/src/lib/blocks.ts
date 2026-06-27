// Runtime shape validation for Block — the Block union in services/items.ts
// is TS-only and not checked at runtime, so a malformed block from the agent
// or an API caller would otherwise be accepted, stored, and then silently
// fail to render (the BlockRenderer switch has no default case). This module
// is the one place that enforces the shape at the write boundary (routes and
// agent tools) so a bad block gets a specific 400/Error instead.

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

export function validateBlock(value: unknown, path = 'block'): string | null {
  if (typeof value !== 'object' || value === null) return `${path} must be an object`;
  const b = value as Record<string, unknown>;
  if (b.id !== undefined && !isString(b.id)) return `${path}.id must be a string`;

  switch (b.type) {
    case 'text':
      if (!isString(b.content)) return `${path}.content must be a string`;
      return null;

    case 'heading':
      if (![1, 2, 3].includes(b.level as number)) return `${path}.level must be 1, 2, or 3`;
      if (!isString(b.text)) return `${path}.text must be a string`;
      return null;

    case 'code':
      if (!isString(b.language)) return `${path}.language must be a string`;
      if (!isString(b.content)) return `${path}.content must be a string`;
      return null;

    case 'table':
      if (!isStringArray(b.headers)) return `${path}.headers must be a string array`;
      if (!Array.isArray(b.rows) || !b.rows.every(isStringArray)) {
        return `${path}.rows must be an array of string arrays`;
      }
      return null;

    case 'image':
      if (!isString(b.url)) return `${path}.url must be a string`;
      if (b.alt !== undefined && !isString(b.alt)) return `${path}.alt must be a string`;
      if (b.caption !== undefined && !isString(b.caption)) return `${path}.caption must be a string`;
      return null;

    case 'task-list': {
      if (!Array.isArray(b.tasks)) return `${path}.tasks must be an array`;
      for (let i = 0; i < b.tasks.length; i++) {
        const t = b.tasks[i] as Record<string, unknown>;
        if (typeof t !== 'object' || t === null) return `${path}.tasks[${i}] must be an object`;
        if (!isString(t.id)) return `${path}.tasks[${i}].id must be a string`;
        if (!isString(t.text)) return `${path}.tasks[${i}].text must be a string`;
        if (!isBoolean(t.done)) return `${path}.tasks[${i}].done must be a boolean`;
      }
      return null;
    }

    case 'callout':
      if (!['info', 'warning', 'success', 'error'].includes(b.variant as string)) {
        return `${path}.variant must be one of info, warning, success, error`;
      }
      if (!isString(b.content)) return `${path}.content must be a string`;
      return null;

    case 'file-browser':
      return null;

    case 'chart': {
      if (!['line', 'bar', 'pie'].includes(b.chartType as string)) {
        return `${path}.chartType must be one of line, bar, pie`;
      }
      if (b.title !== undefined && !isString(b.title)) return `${path}.title must be a string`;
      if (!Array.isArray(b.data)) return `${path}.data must be an array`;
      for (let i = 0; i < b.data.length; i++) {
        const d = b.data[i] as Record<string, unknown>;
        if (typeof d !== 'object' || d === null || !isString(d.label) || !isNumber(d.value)) {
          return `${path}.data[${i}] must be { label: string, value: number }`;
        }
      }
      return null;
    }

    case 'stat': {
      if (!isString(b.label)) return `${path}.label must be a string`;
      if (!isString(b.value)) return `${path}.value must be a string`;
      if (b.trend !== undefined) {
        const t = b.trend as Record<string, unknown>;
        if (typeof t !== 'object' || t === null || !['up', 'down', 'flat'].includes(t.direction as string)) {
          return `${path}.trend.direction must be one of up, down, flat`;
        }
        if (t.label !== undefined && !isString(t.label)) return `${path}.trend.label must be a string`;
      }
      return null;
    }

    case 'list':
      if (!isStringArray(b.items)) return `${path}.items must be a string array`;
      if (b.ordered !== undefined && !isBoolean(b.ordered)) return `${path}.ordered must be a boolean`;
      return null;

    case 'progress':
      if (!isNumber(b.value)) return `${path}.value must be a number`;
      if (b.max !== undefined && !isNumber(b.max)) return `${path}.max must be a number`;
      if (b.label !== undefined && !isString(b.label)) return `${path}.label must be a string`;
      return null;

    case 'input':
      if (!isString(b.label)) return `${path}.label must be a string`;
      if (!isString(b.value)) return `${path}.value must be a string`;
      if (b.placeholder !== undefined && !isString(b.placeholder)) return `${path}.placeholder must be a string`;
      if (b.input_type !== undefined && !['text', 'number', 'multiline', 'select'].includes(b.input_type as string)) {
        return `${path}.input_type must be one of text, number, multiline, select`;
      }
      if (b.options !== undefined && !isStringArray(b.options)) return `${path}.options must be a string array`;
      return null;

    case 'file-preview':
      if (!isString(b.file_id)) return `${path}.file_id must be a string`;
      if (!isString(b.filename)) return `${path}.filename must be a string`;
      if (!isString(b.mime_type)) return `${path}.mime_type must be a string`;
      if (!isString(b.url)) return `${path}.url must be a string`;
      return null;

    case 'relation':
      if (!isString(b.item_id)) return `${path}.item_id must be a string`;
      if (!isString(b.space_id)) return `${path}.space_id must be a string`;
      if (b.label !== undefined && !isString(b.label)) return `${path}.label must be a string`;
      return null;

    default:
      return `${path}.type '${String(b.type)}' is not a recognized block type`;
  }
}

export function validateBlocks(value: unknown, path = 'blocks'): string | null {
  if (!Array.isArray(value)) return `${path} must be an array`;
  for (let i = 0; i < value.length; i++) {
    const err = validateBlock(value[i], `${path}[${i}]`);
    if (err) return err;
  }
  return null;
}
