import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

// ─── Index path ────────────────────────────────────────────────────────────

function indexPath(repoPath: string): string {
  return path.join(repoPath, '.project-index.json');
}

// ─── File walking ──────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.turbo', 'dist', 'build', 'out',
  '.cache', 'coverage', '__pycache__', '.venv', 'venv', '.tox',
  'graphify-out', '.project-index.json',
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
  const ext = path.extname(filePath);
  return SOURCE_EXTS.has(ext);
}

interface FileEntry {
  path: string;
  preview: string;
}

function walkRepo(repoPath: string, maxFiles = 600): FileEntry[] {
  const results: FileEntry[] = [];

  function walk(dir: string): void {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (entry.name.startsWith('.') && entry.name !== '.gitignore' && entry.name !== '.env.example') continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        const abs = path.join(dir, entry.name);
        const rel = path.relative(repoPath, abs);
        let preview = '';
        try {
          const content = fs.readFileSync(abs, 'utf8');
          const lines = content.split('\n').slice(0, 40);
          preview = lines.join('\n').slice(0, 2000);
        } catch {
          // binary or unreadable — skip preview
        }
        results.push({ path: rel, preview });
      }
    }
  }

  walk(repoPath);
  return results;
}

// ─── Public API (mirrors old graphify shape) ───────────────────────────────

export async function hasGraph(repoPath: string): Promise<boolean> {
  try {
    await fsPromises.access(indexPath(repoPath));
    return true;
  } catch {
    return false;
  }
}

export async function buildGraph(repoPath: string, _projectId: string, _apiKey?: string | null): Promise<void> {
  const files = walkRepo(repoPath);
  const index = { built_at: Date.now(), repo_path: repoPath, files };
  await fsPromises.writeFile(indexPath(repoPath), JSON.stringify(index), 'utf8');
  await ensureGitignored(repoPath, '.project-index.json');
}

async function ensureGitignored(repoPath: string, entry: string): Promise<void> {
  const gitignorePath = path.join(repoPath, '.gitignore');
  try {
    const existing = await fsPromises.readFile(gitignorePath, 'utf8').catch(() => '');
    const lines = existing.split('\n');
    if (lines.some(l => l.trim() === entry)) return;
    const appended = existing.endsWith('\n') || existing === ''
      ? existing + entry + '\n'
      : existing + '\n' + entry + '\n';
    await fsPromises.writeFile(gitignorePath, appended, 'utf8');
  } catch {
    // no .gitignore or not writable — skip silently
  }
}

export async function queryGraph(question: string, repoPath: string, apiKey?: string | null): Promise<string> {
  if (!apiKey) {
    return 'No API key configured — cannot answer project questions. Set an Anthropic key in Settings → Agents.';
  }

  let index: { files: FileEntry[] } | null = null;
  try {
    const raw = await fsPromises.readFile(indexPath(repoPath), 'utf8');
    index = JSON.parse(raw) as { files: FileEntry[] };
  } catch {
    // no index — build a quick file-tree only answer
  }

  const client = new Anthropic({ apiKey });

  let context: string;
  if (index) {
    const fileList = index.files.map(f => `### ${f.path}\n${f.preview}`).join('\n\n');
    context = `The following is an index of the project's source files with previews of their first 40 lines:\n\n${fileList}`;
  } else {
    const files = walkRepo(repoPath, 200);
    context = `File tree (no index built yet — previews of first 40 lines):\n\n${files.map(f => `### ${f.path}\n${f.preview}`).join('\n\n')}`;
  }

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: 'You are a code navigator. Answer questions about a codebase using the provided file index. Be specific: cite file paths and line numbers where relevant. If the answer is not in the index, say so.',
    messages: [{ role: 'user', content: `${context}\n\n---\n\nQuestion: ${question}` }],
  });

  const block = msg.content[0];
  return block.type === 'text' ? block.text : 'No answer produced.';
}
