import { describe, it, expect } from 'vitest';
import { validateSchema, validateFields } from './item-schema.js';

describe('validateSchema', () => {
  it('accepts valid schema', () => {
    expect(validateSchema({
      repo_path: { type: 'string', required: true },
      count: { type: 'number' },
      active: { type: 'boolean' },
      status: { type: 'enum', options: ['open', 'closed'] },
    })).toBeNull();
  });

  it('accepts empty schema', () => {
    expect(validateSchema({})).toBeNull();
  });

  it('rejects non-object', () => {
    expect(validateSchema('bad')).toMatch(/object/);
  });

  it('rejects array', () => {
    expect(validateSchema([])).toMatch(/object/);
  });

  it('rejects unknown field type', () => {
    expect(validateSchema({ x: { type: 'date' } })).toMatch(/type/);
  });

  it('rejects enum without options', () => {
    expect(validateSchema({ x: { type: 'enum' } })).toMatch(/options/);
  });

  it('rejects enum with empty options', () => {
    expect(validateSchema({ x: { type: 'enum', options: [] } })).toMatch(/options/);
  });
});

describe('validateFields', () => {
  const schema = {
    name: { type: 'string' as const, required: true },
    count: { type: 'number' as const },
    status: { type: 'enum' as const, options: ['a', 'b'] },
  };

  it('passes when required fields present', () => {
    expect(validateFields({ name: 'hi' }, schema)).toBeNull();
  });

  it('passes with all valid fields', () => {
    expect(validateFields({ name: 'hi', count: 3, status: 'a' }, schema)).toBeNull();
  });

  it('fails when required field missing', () => {
    expect(validateFields({}, schema)).toMatch(/name/);
  });

  it('fails when required field is null', () => {
    expect(validateFields({ name: null }, schema)).toMatch(/name/);
  });

  it('fails when field has wrong type', () => {
    expect(validateFields({ name: 42 }, schema)).toMatch(/name/);
  });

  it('fails when number field has wrong type', () => {
    expect(validateFields({ name: 'x', count: 'not a number' }, schema)).toMatch(/count/);
  });

  it('fails when enum value not in options', () => {
    expect(validateFields({ name: 'x', status: 'c' }, schema)).toMatch(/status/);
  });

  it('ignores unknown fields silently', () => {
    expect(validateFields({ name: 'x', unknown: true }, schema)).toBeNull();
  });

  it('rejects non-object fields', () => {
    expect(validateFields('bad', schema)).toMatch(/object/);
  });
});
