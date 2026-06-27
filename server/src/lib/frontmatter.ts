import matter from 'gray-matter';

export function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const parsed = matter(raw);
  return { frontmatter: parsed.data as Record<string, unknown>, body: parsed.content };
}

export function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  if (Object.keys(frontmatter).length === 0) return body;
  // gray-matter's stringify adds the --- fences and trailing newline.
  return matter.stringify(body, frontmatter);
}
