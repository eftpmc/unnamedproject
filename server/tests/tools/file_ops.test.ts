import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

vi.mock('../../src/services/executor.js', () => ({ requestApproval: vi.fn().mockResolvedValue('approved') }));

vi.mock('../../src/db/index.js', () => ({
  getProjectForUser: vi.fn().mockReturnValue({ id: 'p1', name: 'proj', repo_path: '/fake/repo' }),
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

import { readFile, listDir, writeFile } from '../../src/tools/file_ops.js';
import { requestApproval } from '../../src/services/executor.js';

const mockApproval = requestApproval as ReturnType<typeof vi.fn>;
const ctx = { userId: 'u1', executionId: 'e1', projectId: 'p1', sessionId: 's1', permissionProfile: 'fast' as const };
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
      const result = await readFile({ project_id: 'p1', path: 'README.md' }, ctx);
      expect(result).toBe('file contents');
      expect(mockReadFile).toHaveBeenCalledWith(path.join(WORKTREE_PATH, 'README.md'), 'utf-8');
    });

    it('rejects path traversal', async () => {
      await expect(readFile({ project_id: 'p1', path: '../../etc/passwd' }, ctx)).rejects.toThrow('Path escapes');
    });
  });

  describe('listDir', () => {
    it('lists directory entries with type prefix', async () => {
      const result = await listDir({ project_id: 'p1', path: '.' }, ctx);
      expect(result).toContain('d src');
      expect(result).toContain('f README.md');
    });

    it('defaults to repo root when path omitted', async () => {
      await listDir({ project_id: 'p1' }, ctx);
      expect(mockReaddir).toHaveBeenCalledWith(WORKTREE_PATH, { withFileTypes: true });
    });
  });

  describe('writeFile', () => {
    it('auto-approves on fast profile', async () => {
      await writeFile({ project_id: 'p1', path: 'out.txt', content: 'hello' }, ctx);
      expect(mockApproval).toHaveBeenCalledWith('e1', 'u1', 'write_file', { path: 'out.txt' }, 'agent');
    });

    it('requests user approval on strict profile', async () => {
      await writeFile({ project_id: 'p1', path: 'out.txt', content: 'hello' }, strictCtx);
      expect(mockApproval).toHaveBeenCalledWith('e1', 'u1', 'write_file', { path: 'out.txt' }, 'user');
    });

    it('writes file content after approval', async () => {
      await writeFile({ project_id: 'p1', path: 'out.txt', content: 'hello' }, ctx);
      expect(mockWriteFile).toHaveBeenCalledWith(path.join(WORKTREE_PATH, 'out.txt'), 'hello', 'utf-8');
    });

    it('returns cancelled message when approval rejected', async () => {
      mockApproval.mockResolvedValueOnce('rejected');
      const result = await writeFile({ project_id: 'p1', path: 'out.txt', content: 'hello' }, ctx);
      expect(result).toContain('cancelled');
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('rejects path traversal', async () => {
      await expect(writeFile({ project_id: 'p1', path: '../etc/passwd', content: 'x' }, ctx)).rejects.toThrow('Path escapes');
    });
  });
});
