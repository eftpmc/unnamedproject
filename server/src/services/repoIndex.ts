import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { embed, cosineSimilarity } from './embeddings.js';

// ─── Index path ────────────────────────────────────────────────────────────

function indexPath(repoPath: string): string {
  return path.join(repoPath, '.project-index.json');
}

// ─── File walking ──────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.turbo', 'dist', 'build', 'out',
  '.cache', 'coverage', '__pycache__', '.venv', 'venv', '.tox',
  '.project-index.json',
]);

const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h',
  '.cs', '.php', '.ex', '.exs', '.ml', '.hs', '.clj',
  '.sql', '.graphql', '.proto',
  '.json', '.yaml', '.yml', '.toml', '.env.example',
  '.md', '.mdx',
  '.css', '.scss', '.sass',
  '.sh', '.bash', '.zsh',
  'Dockerfile', 'Makefile', '.gitignore', 'Gemfile', 'Pipfile',
]);

function isSourceFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (SOURCE_EXTS.has(base)) return true;
  return SOURCE_EXTS.has(path.extname(filePath));
}

// ─── Symbol extraction ─────────────────────────────────────────────────────

function extractSymbols(content: string, filePath: string): string[] {
  const ext = path.extname(filePath);
  const symbols: string[] = [];

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    for (const m of content.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+(\w+)/g)) {
      symbols.push(m[1]);
    }
  } else if (ext === '.py') {
    for (const m of content.matchAll(/^(?:async\s+)?def\s+(\w+)|^class\s+(\w+)/gm)) {
      symbols.push(m[1] ?? m[2]);
    }
  } else if (ext === '.go') {
    for (const m of content.matchAll(/^func\s+(?:\([^)]+\)\s+)?(\w+)/gm)) symbols.push(m[1]);
    for (const m of content.matchAll(/^type\s+(\w+)\s+(?:struct|interface)/gm)) symbols.push(m[1]);
  } else if (ext === '.rb') {
    for (const m of content.matchAll(/^\s*def\s+(\w+)|^class\s+(\w+)/gm)) symbols.push(m[1] ?? m[2]);
  } else if (ext === '.rs') {
    for (const m of content.matchAll(/^pub\s+(?:async\s+)?fn\s+(\w+)|^pub\s+struct\s+(\w+)|^pub\s+enum\s+(\w+)/gm)) {
      symbols.push(m[1] ?? m[2] ?? m[3]);
    }
  } else if (ext === '.java' || ext === '.kt') {
    for (const m of content.matchAll(/(?:public|private|protected)?\s+(?:static\s+)?(?:\w+\s+)?(\w+)\s*\(/g)) {
      if (m[1] && /^[A-Z]/.test(m[1])) symbols.push(m[1]); // class-level only
    }
  }

  return [...new Set(symbols.filter(Boolean))];
}

// ─── Index types ───────────────────────────────────────────────────────────

interface FileEntry {
  path: string;
  preview: string;
  symbols: string[];
  mtime: number;
  embedding: number[];
}

interface Index {
  built_at: number;
  repo_path: string;
  files: FileEntry[];
}

interface WalkEntry {
  rel: string;
  abs: string;
  mtime: number;
}

function walkRepo(repoPath: string, maxFiles = 600): WalkEntry[] {
  const results: WalkEntry[] = [];

  function walk(dir: string): void {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (entry.name.startsWith('.') && entry.name !== '.gitignore' && entry.name !== '.env.example') continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        const abs = path.join(dir, entry.name);
        let mtime = 0;
        try { mtime = fs.statSync(abs).mtimeMs; } catch {}
        results.push({ rel: path.relative(repoPath, abs), abs, mtime });
      }
    }
  }

  walk(repoPath);
  return results;
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function hasIndex(repoPath: string): Promise<boolean> {
  try { await fsPromises.access(indexPath(repoPath)); return true; }
  catch { return false; }
}

export async function buildIndex(repoPath: string, _projectId: string): Promise<void> {
  // Load existing index for incremental re-use
  let existingByPath = new Map<string, FileEntry>();
  try {
    const raw = await fsPromises.readFile(indexPath(repoPath), 'utf8');
    const existing = JSON.parse(raw) as Index;
    existingByPath = new Map(existing.files.map(f => [f.path, f]));
  } catch { /* fresh build */ }

  const walked = walkRepo(repoPath);
  const files: FileEntry[] = [];

  for (const { rel, abs, mtime } of walked) {
    const cached = existingByPath.get(rel);
    if (cached && cached.mtime === mtime && cached.embedding?.length > 0) {
      files.push(cached);
      continue;
    }

    let content = '';
    try { content = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const preview = content.split('\n').slice(0, 40).join('\n').slice(0, 2000);
    const symbols = extractSymbols(content, rel);

    const embedText = [rel, symbols.length ? symbols.join(', ') : '', preview].filter(Boolean).join('\n');
    const embedding = Array.from(await embed(embedText));

    files.push({ path: rel, preview, symbols, mtime, embedding });
  }

  const index: Index = { built_at: Date.now(), repo_path: repoPath, files };
  await fsPromises.writeFile(indexPath(repoPath), JSON.stringify(index), 'utf8');
  await ensureGitignored(repoPath, '.project-index.json');
}

async function ensureGitignored(repoPath: string, entry: string): Promise<void> {
  const gitignorePath = path.join(repoPath, '.gitignore');
  try {
    const existing = await fsPromises.readFile(gitignorePath, 'utf8').catch(() => '');
    if (existing.split('\n').some(l => l.trim() === entry)) return;
    const appended = existing.endsWith('\n') || existing === ''
      ? existing + entry + '\n'
      : existing + '\n' + entry + '\n';
    await fsPromises.writeFile(gitignorePath, appended, 'utf8');
  } catch { /* not writable — skip */ }
}

export async function queryIndex(question: string, repoPath: string): Promise<string> {
  let index: Index | null = null;
  try {
    const raw = await fsPromises.readFile(indexPath(repoPath), 'utf8');
    index = JSON.parse(raw) as Index;
  } catch { /* no index */ }

  if (index?.files.length) {
    const questionVec = await embed(question);
    const ranked = index.files
      .filter(f => f.embedding?.length > 0)
      .map(f => ({ f, score: cosineSimilarity(questionVec, new Float32Array(f.embedding)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return 'Most relevant files (answer the question using this context):\n\n' + ranked.map(({ f }) => {
      const symbolLine = f.symbols?.length ? `Symbols: ${f.symbols.join(', ')}\n` : '';
      return `### ${f.path}\n${symbolLine}${f.preview}`;
    }).join('\n\n');
  }

  // No index yet — return raw file tree for the agent to reason over
  const walked = walkRepo(repoPath, 200);
  const entries = walked.map(({ rel, abs }) => {
    let preview = '';
    try { preview = fs.readFileSync(abs, 'utf8').split('\n').slice(0, 10).join('\n'); } catch {}
    return `### ${rel}\n${preview}`;
  });
  return 'No index built yet. File tree (answer the question using this context):\n\n' + entries.join('\n\n');
}

export async function searchIndex(query: string, repoPath: string, limit = 10): Promise<string> {
  let index: Index | null = null;
  try {
    const raw = await fsPromises.readFile(indexPath(repoPath), 'utf8');
    index = JSON.parse(raw) as Index;
  } catch { /* no index */ }

  if (!index?.files.length) {
    return 'No index found for this project. Run rebuild_index first, or use project_query which builds it automatically.';
  }

  const queryVec = await embed(query);
  const queryLower = query.toLowerCase();

  const ranked = index.files
    .filter(f => f.embedding?.length > 0)
    .map(f => {
      const semantic = cosineSimilarity(queryVec, new Float32Array(f.embedding));
      // Boost files whose symbol list contains an exact or partial match
      const symbolBoost = f.symbols?.some(s => s.toLowerCase().includes(queryLower)) ? 0.15 : 0;
      const pathBoost = f.path.toLowerCase().includes(queryLower) ? 0.1 : 0;
      return { f, score: semantic + symbolBoost + pathBoost };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked.map(({ f }) => {
    const symbolLine = f.symbols?.length ? `symbols: ${f.symbols.join(', ')}\n` : '';
    return `${f.path}${symbolLine ? ' — ' + symbolLine.trim() : ''}\n${f.preview}`;
  }).join('\n\n---\n\n');
}
