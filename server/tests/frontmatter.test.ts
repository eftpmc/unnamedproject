import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter } from '../src/lib/frontmatter.js';

describe('frontmatter', () => {
  it('parses YAML frontmatter and body', () => {
    const raw = '---\ntype: application\nstatus: applied\n---\n# Acme\nbody text\n';
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({ type: 'application', status: 'applied' });
    expect(body.trim()).toBe('# Acme\nbody text');
  });

  it('returns empty frontmatter when none present', () => {
    const { frontmatter, body } = parseFrontmatter('# Just a heading\n');
    expect(frontmatter).toEqual({});
    expect(body.trim()).toBe('# Just a heading');
  });

  it('round-trips through serialize', () => {
    const out = serializeFrontmatter({ type: 'resume', master: true }, '# Resume\n');
    const { frontmatter, body } = parseFrontmatter(out);
    expect(frontmatter).toEqual({ type: 'resume', master: true });
    expect(body.trim()).toBe('# Resume');
  });

  it('serializes empty frontmatter as plain body', () => {
    expect(serializeFrontmatter({}, '# Hi\n')).toBe('# Hi\n');
  });
});
