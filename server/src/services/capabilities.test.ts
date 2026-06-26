import { describe, it, expect } from 'vitest';
import {
  ALLOWED_CAPABILITIES,
  validateCapabilities,
  validateCapabilityFieldContracts,
} from './capabilities.js';

describe('validateCapabilities', () => {
  it('accepts empty array', () => {
    expect(validateCapabilities([])).toBeNull();
  });

  it('accepts all known capabilities', () => {
    expect(validateCapabilities(['git-aware', 'file-readable', 'web-fetchable', 'embeddable', 'schedulable'])).toBeNull();
  });

  it('accepts a subset', () => {
    expect(validateCapabilities(['git-aware', 'file-readable'])).toBeNull();
  });

  it('rejects unknown capability', () => {
    expect(validateCapabilities(['file-readable', 'auto-syncing'])).toMatch(/auto-syncing/);
  });

  it('error lists available capabilities', () => {
    const err = validateCapabilities(['bad']);
    expect(err).toMatch(/git-aware/);
  });

  it('rejects non-array', () => {
    expect(validateCapabilities('file-readable')).toMatch(/array/);
  });

  it('rejects object', () => {
    expect(validateCapabilities({})).toMatch(/array/);
  });
});

describe('validateCapabilityFieldContracts', () => {
  it('passes with no capabilities', () => {
    expect(validateCapabilityFieldContracts({}, [])).toBeNull();
  });

  it('passes when file-readable has file_path', () => {
    const schema = { file_path: { type: 'string' as const, required: true } };
    expect(validateCapabilityFieldContracts(schema, ['file-readable'])).toBeNull();
  });

  it('fails when file-readable missing file_path', () => {
    expect(validateCapabilityFieldContracts({}, ['file-readable'])).toMatch(/file_path/);
  });

  it('fails when git-aware missing repo_path', () => {
    expect(validateCapabilityFieldContracts({}, ['git-aware'])).toMatch(/repo_path/);
  });

  it('passes when git-aware has repo_path', () => {
    const schema = { repo_path: { type: 'string' as const, required: true } };
    expect(validateCapabilityFieldContracts(schema, ['git-aware'])).toBeNull();
  });

  it('passes when schedulable has cron', () => {
    const schema = { cron: { type: 'string' as const, required: true } };
    expect(validateCapabilityFieldContracts(schema, ['schedulable'])).toBeNull();
  });

  it('fails when schedulable missing cron', () => {
    expect(validateCapabilityFieldContracts({}, ['schedulable'])).toMatch(/cron/);
  });

  it('embeddable needs no required field', () => {
    expect(validateCapabilityFieldContracts({}, ['embeddable'])).toBeNull();
  });
});
