import { registerTool } from '../registry.js';
import fs from 'fs/promises';
import path from 'path';
import { getDb } from '../../db/index.js';
import { parseFrontmatter, serializeFrontmatter } from '../../lib/frontmatter.js';
import { resolveInFiles, ensureFilesRepo, commitFiles } from '../../lib/spaceFs.js';
import { getProjectForUser } from '../../services/projects.js';
import { listFiles } from '../../services/files.js';
import { newId } from '../../lib/ids.js';

// --- ATS platform config ---

const ATS_KNOWN_SLUGS: Record<string, { platform: 'greenhouse' | 'lever' | 'ashby'; slug: string }> = {
  anthropic: { platform: 'greenhouse', slug: 'anthropic' },
  openai: { platform: 'greenhouse', slug: 'openai' },
  stripe: { platform: 'greenhouse', slug: 'stripe' },
  figma: { platform: 'greenhouse', slug: 'figma' },
  spacex: { platform: 'greenhouse', slug: 'spacex' },
  palantir: { platform: 'greenhouse', slug: 'palantir' },
  amazon: { platform: 'greenhouse', slug: 'amazon' },
  'scale ai': { platform: 'greenhouse', slug: 'scaleai' },
  skydio: { platform: 'greenhouse', slug: 'skydio' },
  waymo: { platform: 'greenhouse', slug: 'waymo' },
  anduril: { platform: 'lever', slug: 'anduril-industries' },
  hermeus: { platform: 'lever', slug: 'hermeus' },
  rivian: { platform: 'lever', slug: 'rivian' },
  notion: { platform: 'ashby', slug: 'notion' },
  linear: { platform: 'ashby', slug: 'linear' },
  vercel: { platform: 'ashby', slug: 'vercel' },
  ramp: { platform: 'ashby', slug: 'ramp' },
  circleback: { platform: 'ashby', slug: 'circleback' },
  '1password': { platform: 'ashby', slug: '1password' },
};

// Track F weekday rotation (0=Sun,1=Mon,...,6=Sat)
const TRACK_F: Record<number, string[]> = {
  1: ['OpenAI', 'Anthropic', 'Google DeepMind', 'Meta AI', 'Microsoft Research'],
  2: ['SpaceX', 'Palantir', 'Anduril', 'Scale AI', 'Waymo'],
  3: ['Citadel', 'Jane Street', 'Two Sigma', 'Hudson River Trading', 'D.E. Shaw'],
  4: ['Stripe', 'Figma', 'Linear', 'Vercel', 'Notion'],
  5: ['NASA', 'CERN', 'LANL', 'Sandia', 'Oak Ridge', 'Clemson University labs', 'CU-ICAR', 'BMW Group IT', 'Boeing South Carolina', 'Savannah River National Laboratory'],
};

function getFilesPath(projectId: string): string {
  const row = getDb().prepare('SELECT files_path FROM projects WHERE id = ?').get(projectId) as { files_path: string } | undefined;
  if (!row) throw new Error(`Project ${projectId} not found`);
  return row.files_path;
}

function rowByPath(projectId: string, p: string): { id: string; tags: string } | undefined {
  return getDb().prepare('SELECT id, tags FROM files WHERE project_id = ? AND path = ?').get(projectId, p) as { id: string; tags: string } | undefined;
}

// Attempt to extract a concrete deadline date from a free-form string tag.
// Returns a Date if something parseable is found, otherwise null.
function extractDate(s: string): Date | null {
  // Match patterns like "Jul 15, 2026", "July 15 2026", "2026-07-15"
  const patterns = [
    /(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/gi,
    /(\d{4}-\d{2}-\d{2})/g,
    /(\d{1,2}\/\d{1,2}\/\d{4})/g,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const d = new Date(m[0]);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

export function registerInternshipHandlers(): void {

  // ----------------------------------------------------------------
  // append_log_entry
  // ----------------------------------------------------------------
  registerTool({
    name: 'append_log_entry',
    description: 'Append a dated markdown section to a project log file (e.g. opportunity-log.md) without reading the full file into agent context. Creates the file if it does not exist. Returns the updated file record.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        path: { type: 'string', description: 'Relative path of the log file within the project, e.g. opportunity-log.md' },
        entry: { type: 'string', description: 'Markdown text to append (a dated section heading + body)' },
      },
      required: ['project_id', 'path', 'entry'],
    },
    handler: async (args, userId, sessionId) => {
      const project = getProjectForUser(args.project_id as string, userId);
      if (!project) return `Error: project ${args.project_id} not found`;

      const filesPath = getFilesPath(args.project_id as string);
      await ensureFilesRepo(filesPath);
      const abs = resolveInFiles(filesPath, args.path as string);

      let existing: string | null = null;
      try {
        existing = await fs.readFile(abs, 'utf-8');
      } catch {
        // file doesn't exist yet — start fresh
      }

      const { frontmatter, body } = existing
        ? parseFrontmatter(existing)
        : { frontmatter: { type: 'log', status: 'active' }, body: `# ${args.path as string}\n` };

      const newBody = body.trimEnd() + '\n\n' + (args.entry as string).trimStart();
      const content = serializeFrontmatter(frontmatter, newBody);

      await fs.mkdir(path.dirname(abs), { recursive: true }).catch(() => {});
      await fs.writeFile(abs, content, 'utf-8');

      const now = Math.floor(Date.now() / 1000);
      const row = rowByPath(args.project_id as string, args.path as string);
      if (row) {
        getDb().prepare('UPDATE files SET updated_at=?, source_session_id=COALESCE(?,source_session_id) WHERE id=?')
          .run(now, sessionId ?? null, row.id);
      } else {
        const id = newId();
        const tags = JSON.stringify(frontmatter);
        getDb().prepare(
          'INSERT INTO files (id,project_id,path,title,type,status,mime_type,tags,source_session_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        ).run(id, args.project_id, args.path, args.path, 'log', 'active', 'text/markdown', tags, sessionId ?? null, now, now);
      }

      await commitFiles(filesPath, `append log entry to ${args.path as string}`);
      return JSON.stringify({ ok: true, path: args.path });
    },
  });

  // ----------------------------------------------------------------
  // get_upcoming_deadlines
  // ----------------------------------------------------------------
  registerTool({
    name: 'get_upcoming_deadlines',
    description: 'Scan all application files in a project and return any with deadlines falling within the given number of days. Reads tag fields (dates, term, deadline) without loading file bodies. Use this at the start of each scan run instead of reading the full opportunity log.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        days: { type: 'number', description: 'Lookahead window in days (default 14)' },
      },
      required: ['project_id'],
    },
    handler: async (args, userId) => {
      const project = getProjectForUser(args.project_id as string, userId);
      if (!project) return `Error: project ${args.project_id} not found`;

      const days = typeof args.days === 'number' ? args.days : 14;
      const now = Date.now();
      const cutoff = now + days * 86400 * 1000;

      const files = listFiles(args.project_id as string, { type: 'application' });
      const urgent: Array<{ path: string; title: string; status: string | null; deadline: string; daysUntil: number }> = [];

      for (const f of files) {
        const tags = f.tags as Record<string, unknown>;
        // Check all string tag values for date-like content
        for (const [key, val] of Object.entries(tags)) {
          if (typeof val !== 'string') continue;
          const d = extractDate(val);
          if (!d) continue;
          const ts = d.getTime();
          if (ts >= now && ts <= cutoff) {
            urgent.push({
              path: f.path,
              title: f.title,
              status: f.status,
              deadline: `${key}: ${val}`,
              daysUntil: Math.ceil((ts - now) / 86400000),
            });
            break; // one hit per file is enough
          }
        }
      }

      urgent.sort((a, b) => a.daysUntil - b.daysUntil);
      return JSON.stringify(urgent);
    },
  });

  // ----------------------------------------------------------------
  // check_seen
  // ----------------------------------------------------------------
  registerTool({
    name: 'check_seen',
    description: 'Batch-check a list of {company, role} pairs against seen-opportunities.md without loading the full file into agent context. Returns each entry annotated with seen: true/false.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              company: { type: 'string' },
              role: { type: 'string' },
            },
            required: ['company', 'role'],
          },
          description: 'Opportunities to check',
        },
      },
      required: ['project_id', 'entries'],
    },
    handler: async (args, userId) => {
      const project = getProjectForUser(args.project_id as string, userId);
      if (!project) return `Error: project ${args.project_id} not found`;

      const filesPath = getFilesPath(args.project_id as string);
      const abs = resolveInFiles(filesPath, 'seen-opportunities.md');

      let seenText = '';
      try {
        const raw = await fs.readFile(abs, 'utf-8');
        seenText = parseFrontmatter(raw).body.toLowerCase();
      } catch {
        // file doesn't exist — nothing seen yet
      }

      const entries = args.entries as Array<{ company: string; role: string }>;
      const result = entries.map(e => ({
        company: e.company,
        role: e.role,
        seen: seenText.includes(e.company.toLowerCase()) && seenText.includes(e.role.toLowerCase()),
      }));

      return JSON.stringify(result);
    },
  });

  // ----------------------------------------------------------------
  // get_track_f_companies
  // ----------------------------------------------------------------
  registerTool({
    name: 'get_track_f_companies',
    description: 'Return the Track F watchlist companies assigned to a given date (or today) based on the weekday rotation. Also returns the ATS platform and slug for each company when known, so query_ats can be called directly.',
    inputSchema: {
      type: 'object',
      properties: {
        date_iso: { type: 'string', description: 'ISO date string (e.g. 2026-07-01). Defaults to today.' },
      },
    },
    handler: async (args) => {
      const d = args.date_iso ? new Date(args.date_iso as string) : new Date();
      const dow = d.getDay(); // 0=Sun, 1=Mon...6=Sat

      let companies: string[];
      if (dow === 0 || dow === 6) {
        // Weekend: return all groups not covered M-F combined (pick two least-recently-covered)
        // For simplicity return Mon + Tue groups as defaults
        companies = [...TRACK_F[1], ...TRACK_F[2]];
      } else {
        companies = TRACK_F[dow] ?? [];
      }

      const enriched = companies.map(name => {
        const key = name.toLowerCase();
        const ats = ATS_KNOWN_SLUGS[key] ?? null;
        return { company: name, ats };
      });

      return JSON.stringify({ date: d.toISOString().split('T')[0], day_of_week: d.toLocaleDateString('en-US', { weekday: 'long' }), companies: enriched });
    },
  });

  // ----------------------------------------------------------------
  // query_ats
  // ----------------------------------------------------------------
  registerTool({
    name: 'query_ats',
    description: 'Query a public ATS job board API (Greenhouse, Lever, or Ashby) for internship/co-op postings matching given keywords. Returns a filtered list of matching roles with title, location, URL, and posting date. No authentication required. Use instead of browser navigation or web search for Track F company checks.',
    inputSchema: {
      type: 'object',
      properties: {
        company: { type: 'string', description: 'Company name (e.g. "anthropic") — looked up in the known-slug table first.' },
        platform: { type: 'string', enum: ['greenhouse', 'lever', 'ashby'], description: 'ATS platform. Auto-detected from known company names when omitted.' },
        slug: { type: 'string', description: 'ATS board slug (e.g. "anthropic"). Required if the company is not in the known-slug table.' },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Job title must contain at least one of these terms (case-insensitive). E.g. ["intern", "internship", "co-op"]',
        },
      },
      required: ['company'],
    },
    handler: async (args) => {
      const companyKey = (args.company as string).toLowerCase().trim();
      const known = ATS_KNOWN_SLUGS[companyKey];
      const platform = (args.platform as string | undefined) ?? known?.platform;
      const slug = (args.slug as string | undefined) ?? known?.slug;
      const keywords = (args.keywords as string[] | undefined) ?? ['intern', 'internship', 'co-op', 'coop'];

      if (!platform) return `Error: unknown platform for "${args.company}". Pass platform and slug explicitly.`;
      if (!slug) return `Error: no ATS slug for "${args.company}". Pass slug explicitly.`;

      const filter = (title: string) =>
        keywords.some(k => title.toLowerCase().includes(k.toLowerCase()));

      try {
        if (platform === 'greenhouse') {
          const res = await fetch(`https://api.greenhouse.io/v1/boards/${slug}/jobs`);
          if (!res.ok) return `Error: Greenhouse returned ${res.status} for ${slug}`;
          const data = await res.json() as { jobs?: Array<{ title: string; location: { name: string }; absolute_url: string; updated_at: string }> };
          const matches = (data.jobs ?? []).filter(j => filter(j.title));
          return JSON.stringify(matches.map(j => ({
            title: j.title,
            location: j.location?.name ?? '',
            url: j.absolute_url,
            updated: j.updated_at,
            company: args.company,
            platform: 'greenhouse',
          })));
        }

        if (platform === 'lever') {
          const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);
          if (!res.ok) return `Error: Lever returned ${res.status} for ${slug}`;
          const data = await res.json() as Array<{ text: string; categories: { location?: string }; hostedUrl: string; createdAt: number }>;
          const matches = data.filter(j => filter(j.text));
          return JSON.stringify(matches.map(j => ({
            title: j.text,
            location: j.categories?.location ?? '',
            url: j.hostedUrl,
            updated: new Date(j.createdAt).toISOString(),
            company: args.company,
            platform: 'lever',
          })));
        }

        if (platform === 'ashby') {
          const res = await fetch(`https://api.ashbyhq.com/posting-public/job-board/${slug}`);
          if (!res.ok) return `Error: Ashby returned ${res.status} for ${slug}`;
          const data = await res.json() as { jobPostings?: Array<{ title: string; isRemote: boolean; location?: string; externalLink?: string; jobUrl?: string; publishedDate?: string }> };
          const matches = (data.jobPostings ?? []).filter(j => filter(j.title));
          return JSON.stringify(matches.map(j => ({
            title: j.title,
            location: j.isRemote ? 'Remote' : (j.location ?? ''),
            url: j.externalLink ?? j.jobUrl ?? '',
            updated: j.publishedDate ?? '',
            company: args.company,
            platform: 'ashby',
          })));
        }

        return `Error: unsupported platform "${platform}"`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: ATS fetch failed: ${msg}`;
      }
    },
  });
}
