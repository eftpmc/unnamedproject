import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

vi.mock('../../src/services/executor.js', () => ({ requestApproval: vi.fn().mockResolvedValue('approved') }));

vi.mock('../../src/db/index.js', () => ({
  getSpaceForUser: vi.fn().mockReturnValue({ id: 'p1', name: 'proj', enabled_connection_ids: '[]' }),
  getDataDir: vi.fn().mockReturnValue('/tmp/test-data'),
}));

vi.mock('../../src/services/items.js', () => ({
  getItemById: vi.fn().mockReturnValue(
    { id: 'item-1', space_id: 'p1', type: 'repo', name: 'proj', repo_path: '/fake/repo', default_branch: null, created_at: 0, source_session_id: null, source_plan_id: null, source_step_id: null },
  ),
}));

vi.mock('../../src/lib/worktree.js', () => ({
  ensureWorktree: vi.fn().mockResolvedValue({ worktree_path: '/fake/repo' }),
}));

const REPO_PATH = '/fake/repo';
const WORKTREE_PATH = '/fake/repo';

const mockReadFile = vi.fn().mockResolvedValue('file contents');
const mockReaddir = vi.fn().mockResolvedValue([
  { name: 'src', isDirectory: () => true },
  { name: 'README.md', isDirectory: () => false },
]);
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);

vi.mock('fs/promises', () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    readdir: (...args: unknown[]) => mockReaddir(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  },
}));

import { readFile, listDir, writeFile, searchFiles } from '../../src/tools/file_ops.js';
import { requestApproval } from '../../src/services/executor.js';

const mockApproval = requestApproval as ReturnType<typeof vi.fn>;
const ctx = { userId: 'u1', executionId: 'e1', sessionId: 's1', permissionProfile: 'fast' as const };
const strictCtx = { ...ctx, permissionProfile: 'strict' as const };

beforeEach(() => {
  vi.clearAllMocks();
  mockApproval.mockResolvedValue('approved');
  mockReadFile.mockResolvedValue('file contents');
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
  mockReaddir.mockResolvedValue([
    { name: 'src', isDirectory: () => true },
    { name: 'README.md', isDirectory: () => false },
  ]);
});

describe('file_ops', () => {
  describe('readFile', () => {
    it('reads a file and returns its content', async () => {
      const result = await readFile({ space_id: 'p1', item_id: 'item-1', path: 'README.md' }, ctx);
      expect(result).toBe('file contents');
      expect(mockReadFile).toHaveBeenCalledWith(path.join(WORKTREE_PATH, 'README.md'), 'utf-8');
    });

    it('rejects path traversal', async () => {
      await expect(readFile({ space_id: 'p1', item_id: 'item-1', path: '../../etc/passwd' }, ctx)).rejects.toThrow('Path escapes');
    });
  });

  describe('listDir', () => {
    it('lists directory entries with type prefix', async () => {
      const result = await listDir({ space_id: 'p1', item_id: 'item-1', path: '.' }, ctx);
      expect(result).toContain('d src');
      expect(result).toContain('f README.md');
    });

    it('defaults to repo root when path omitted', async () => {
      await listDir({ space_id: 'p1', item_id: 'item-1' }, ctx);
      expect(mockReaddir).toHaveBeenCalledWith(WORKTREE_PATH, { withFileTypes: true });
    });
  });

  describe('writeFile', () => {
    it('auto-approves on fast profile', async () => {
      await writeFile({ space_id: 'p1', item_id: 'item-1', path: 'out.txt', content: 'hello' }, ctx);
      expect(mockApproval).toHaveBeenCalledWith('e1', 'u1', 'write_file', { path: 'out.txt' }, 'agent');
    });

    it('requests user approval on strict profile', async () => {
      await writeFile({ space_id: 'p1', item_id: 'item-1', path: 'out.txt', content: 'hello' }, strictCtx);
      expect(mockApproval).toHaveBeenCalledWith('e1', 'u1', 'write_file', { path: 'out.txt' }, 'user');
    });

    it('writes file content after approval', async () => {
      await writeFile({ space_id: 'p1', item_id: 'item-1', path: 'out.txt', content: 'hello' }, ctx);
      expect(mockWriteFile).toHaveBeenCalledWith(path.join(WORKTREE_PATH, 'out.txt'), 'hello', 'utf-8');
    });

    it('returns cancelled message when approval rejected', async () => {
      mockApproval.mockResolvedValueOnce('rejected');
      const result = await writeFile({ space_id: 'p1', item_id: 'item-1', path: 'out.txt', content: 'hello' }, ctx);
      expect(result).toContain('cancelled');
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('rejects path traversal', async () => {
      await expect(writeFile({ space_id: 'p1', item_id: 'item-1', path: '../etc/passwd', content: 'x' }, ctx)).rejects.toThrow('Path escapes');
    });
  });

  describe('searchFiles', () => {
    function makeTree(files: Record<string, string>) {
      mockReaddir.mockImplementation(async (dir: string) => {
        const rel = dir === REPO_PATH ? '' : (dir as string).slice(REPO_PATH.length + 1);
        return Object.keys(files)
          .filter(f => {
            const parts = f.split('/');
            if (parts.length === 1) return rel === '';
            return parts.slice(0, -1).join('/') === rel;
          })
          .map(f => {
            const name = f.split('/').pop()!;
            return { name, isDirectory: () => false, isFile: () => true };
          });
      });
      mockReadFile.mockImplementation(async (p: string) => {
        const rel = (p as string).slice(REPO_PATH.length + 1);
        return files[rel] ?? '';
      });
    }

    it('returns matches with file and line number', async () => {
      makeTree({ 'index.ts': 'const foo = 1;\nconst bar = 2;\n' });
      const result = await searchFiles({ space_id: 'p1', item_id: 'item-1', pattern: 'foo' }, ctx);
      expect(result).toContain('index.ts:1:');
      expect(result).not.toContain('index.ts:2:');
    });

    it('file_glob *.ts escapes the dot — does not match constants.py', async () => {
      makeTree({ 'index.ts': 'match', 'constants.py': 'match' });
      const result = await searchFiles({ space_id: 'p1', item_id: 'item-1', pattern: 'match', file_glob: '*.ts' }, ctx);
      expect(result).toContain('index.ts');
      expect(result).not.toContain('constants.py');
    });

    it('file_glob *.spec.ts only matches spec files', async () => {
      makeTree({ 'foo.spec.ts': 'test', 'foo.ts': 'test', 'fooxspecyts': 'test' });
      const result = await searchFiles({ space_id: 'p1', item_id: 'item-1', pattern: 'test', file_glob: '*.spec.ts' }, ctx);
      expect(result).toContain('foo.spec.ts');
      expect(result).not.toContain('foo.ts:');
      expect(result).not.toContain('fooxspecyts');
    });

    it('returns no-matches message when nothing found', async () => {
      makeTree({ 'index.ts': 'hello world' });
      const result = await searchFiles({ space_id: 'p1', item_id: 'item-1', pattern: 'zzznomatch' }, ctx);
      expect(result).toContain('No matches');
    });

    it('ignore_case matches case-insensitively', async () => {
      makeTree({ 'readme.md': 'Hello World' });
      const result = await searchFiles({ space_id: 'p1', item_id: 'item-1', pattern: 'hello', ignore_case: true }, ctx);
      expect(result).toContain('readme.md');
    });
  });
});
