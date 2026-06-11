import { Octokit } from '@octokit/rest';
import { requestApproval } from '../services/executor.js';

interface GithubInput {
  op: 'list_repos' | 'get_repo' | 'list_issues' | 'get_issue' | 'create_issue' | 'create_issue_comment'
    | 'list_pull_requests' | 'get_pull_request' | 'create_pull_request';
  owner?: string;
  repo?: string;
  issue_number?: number;
  pr_number?: number;
  comment_body?: string;
  title?: string;
  body?: string;
  head?: string;
  base?: string;
  labels?: string[];
}

interface ToolContext {
  userId: string;
  executionId: string;
  token: string;
}

const WRITE_OPS = new Set(['create_issue_comment', 'create_issue', 'create_pull_request']);

export async function runGithubApi(input: GithubInput, ctx: ToolContext): Promise<string> {
  if (WRITE_OPS.has(input.op)) {
    const decision = await requestApproval(ctx.executionId, ctx.userId, `github ${input.op}`, input as unknown as Record<string, unknown>, 'user');
    if (decision === 'rejected') return `User rejected github ${input.op}`;
  }

  const octokit = new Octokit({ auth: ctx.token });

  switch (input.op) {
    case 'list_repos': {
      const { data } = await octokit.repos.listForAuthenticatedUser({ per_page: 30 });
      return data.map(r => `${r.full_name} — ${r.description ?? ''}`).join('\n');
    }
    case 'get_repo': {
      const { data } = await octokit.repos.get({ owner: input.owner!, repo: input.repo! });
      return JSON.stringify({ name: data.full_name, stars: data.stargazers_count, default_branch: data.default_branch });
    }
    case 'list_issues': {
      const { data } = await octokit.issues.listForRepo({ owner: input.owner!, repo: input.repo!, state: 'open', per_page: 20 });
      return data.filter(i => !i.pull_request).map(i => `#${i.number} ${i.title}`).join('\n');
    }
    case 'get_issue': {
      const { data } = await octokit.issues.get({ owner: input.owner!, repo: input.repo!, issue_number: input.issue_number! });
      return `#${data.number} ${data.title}\n\n${data.body ?? ''}`;
    }
    case 'create_issue': {
      const { data } = await octokit.issues.create({
        owner: input.owner!, repo: input.repo!, title: input.title!, body: input.body,
        labels: input.labels,
      });
      return `Created issue #${data.number}: ${data.html_url}`;
    }
    case 'create_issue_comment': {
      await octokit.issues.createComment({ owner: input.owner!, repo: input.repo!, issue_number: input.issue_number!, body: input.comment_body! });
      return `Comment posted on #${input.issue_number}`;
    }
    case 'list_pull_requests': {
      const { data } = await octokit.pulls.list({ owner: input.owner!, repo: input.repo!, state: 'open', per_page: 20 });
      return data.map(pr => `#${pr.number} ${pr.title} (${pr.head.ref} → ${pr.base.ref})`).join('\n');
    }
    case 'get_pull_request': {
      const { data } = await octokit.pulls.get({ owner: input.owner!, repo: input.repo!, pull_number: input.pr_number! });
      return `#${data.number} ${data.title}\n${data.head.ref} → ${data.base.ref}\n\n${data.body ?? ''}`;
    }
    case 'create_pull_request': {
      const { data } = await octokit.pulls.create({
        owner: input.owner!, repo: input.repo!, title: input.title!, body: input.body ?? '',
        head: input.head!, base: input.base ?? 'main',
      });
      return `Created PR #${data.number}: ${data.html_url}`;
    }
    default:
      return 'Unknown github op';
  }
}
