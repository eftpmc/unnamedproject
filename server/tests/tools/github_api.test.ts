import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/executor.js', () => ({ requestApproval: vi.fn().mockResolvedValue('approved') }));

// Build chainable Octokit mock
const mockData = {
  repos: [{ full_name: 'user/repo', description: 'desc' }],
  repo: { full_name: 'user/repo', stargazers_count: 42, default_branch: 'main' },
  issues: [
    { number: 1, title: 'Bug A', pull_request: undefined },
    { number: 2, title: 'PR B', pull_request: { url: 'x' } },
  ],
  issue: { number: 3, title: 'Issue 3', body: 'details' },
  createdIssue: { number: 5, html_url: 'https://github.com/user/repo/issues/5' },
  prs: [{ number: 10, title: 'feat', head: { ref: 'feat-branch' }, base: { ref: 'main' } }],
  pr: { number: 10, title: 'feat', head: { ref: 'feat-branch' }, base: { ref: 'main' }, body: 'desc' },
  createdPr: { number: 11, html_url: 'https://github.com/user/repo/pull/11' },
};

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    repos: {
      listForAuthenticatedUser: vi.fn().mockResolvedValue({ data: mockData.repos }),
      get: vi.fn().mockResolvedValue({ data: mockData.repo }),
    },
    issues: {
      listForRepo: vi.fn().mockResolvedValue({ data: mockData.issues }),
      get: vi.fn().mockResolvedValue({ data: mockData.issue }),
      create: vi.fn().mockResolvedValue({ data: mockData.createdIssue }),
      createComment: vi.fn().mockResolvedValue({}),
    },
    pulls: {
      list: vi.fn().mockResolvedValue({ data: mockData.prs }),
      get: vi.fn().mockResolvedValue({ data: mockData.pr }),
      create: vi.fn().mockResolvedValue({ data: mockData.createdPr }),
    },
  })),
}));

import { runGithubApi } from '../../src/tools/github_api.js';
import { requestApproval } from '../../src/services/executor.js';

const mockApproval = requestApproval as ReturnType<typeof vi.fn>;
const ctx = { userId: 'u1', executionId: 'e1', token: 'gh-token' };

beforeEach(() => mockApproval.mockResolvedValue('approved'));

describe('github_api', () => {
  it('list_repos returns repo names', async () => {
    const result = await runGithubApi({ op: 'list_repos' }, ctx);
    expect(result).toContain('user/repo');
  });

  it('get_repo returns repo details', async () => {
    const result = await runGithubApi({ op: 'get_repo', owner: 'user', repo: 'repo' }, ctx);
    expect(result).toContain('42');
  });

  it('list_issues filters out PRs', async () => {
    const result = await runGithubApi({ op: 'list_issues', owner: 'user', repo: 'repo' }, ctx);
    expect(result).toContain('#1 Bug A');
    expect(result).not.toContain('PR B');
  });

  it('get_issue returns issue details', async () => {
    const result = await runGithubApi({ op: 'get_issue', owner: 'user', repo: 'repo', issue_number: 3 }, ctx);
    expect(result).toContain('#3 Issue 3');
    expect(result).toContain('details');
  });

  it('create_issue requests approval and creates issue', async () => {
    const result = await runGithubApi({ op: 'create_issue', owner: 'user', repo: 'repo', title: 'New bug' }, ctx);
    expect(mockApproval).toHaveBeenCalledWith('e1', 'u1', 'github create_issue', expect.any(Object), 'user');
    expect(result).toContain('#5');
  });

  it('create_issue returns cancelled if approval rejected', async () => {
    mockApproval.mockResolvedValueOnce('rejected');
    const result = await runGithubApi({ op: 'create_issue', owner: 'user', repo: 'repo', title: 'New bug' }, ctx);
    expect(result).toContain('rejected');
  });

  it('create_issue_comment requests approval', async () => {
    const result = await runGithubApi({ op: 'create_issue_comment', owner: 'user', repo: 'repo', issue_number: 1, comment_body: 'lgtm' }, ctx);
    expect(mockApproval).toHaveBeenCalledWith('e1', 'u1', 'github create_issue_comment', expect.any(Object), 'user');
    expect(result).toContain('#1');
  });

  it('list_pull_requests returns PR list', async () => {
    const result = await runGithubApi({ op: 'list_pull_requests', owner: 'user', repo: 'repo' }, ctx);
    expect(result).toContain('#10 feat');
    expect(result).toContain('feat-branch');
  });

  it('get_pull_request returns PR details', async () => {
    const result = await runGithubApi({ op: 'get_pull_request', owner: 'user', repo: 'repo', pr_number: 10 }, ctx);
    expect(result).toContain('#10 feat');
  });

  it('create_pull_request requests approval and creates PR', async () => {
    const result = await runGithubApi({
      op: 'create_pull_request', owner: 'user', repo: 'repo',
      title: 'My PR', head: 'feat-branch', base: 'main',
    }, ctx);
    expect(mockApproval).toHaveBeenCalledWith('e1', 'u1', 'github create_pull_request', expect.any(Object), 'user');
    expect(result).toContain('#11');
  });

  it('create_pull_request returns cancelled if approval rejected', async () => {
    mockApproval.mockResolvedValueOnce('rejected');
    const result = await runGithubApi({
      op: 'create_pull_request', owner: 'user', repo: 'repo',
      title: 'My PR', head: 'feat-branch',
    }, ctx);
    expect(result).toContain('rejected');
  });
});
