import { Octokit } from '@octokit/rest';
import { requestApproval } from '../services/executor.js';

interface GithubInput {
  op: 'list_repos' | 'get_repo' | 'list_issues' | 'get_issue' | 'create_issue_comment';
  owner?: string;
  repo?: string;
  issue_number?: number;
  comment_body?: string;
}

interface ToolContext {
  userId: string;
  executionId: string;
  token: string;
}

const WRITE_OPS = new Set(['create_issue_comment']);

export async function runGithubApi(input: GithubInput, ctx: ToolContext): Promise<string> {
  if (WRITE_OPS.has(input.op)) {
    const decision = await requestApproval(ctx.executionId, ctx.userId, `github ${input.op}`, input as unknown as Record<string, unknown>);
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
      return data.map(i => `#${i.number} ${i.title}`).join('\n');
    }
    case 'get_issue': {
      const { data } = await octokit.issues.get({ owner: input.owner!, repo: input.repo!, issue_number: input.issue_number! });
      return `#${data.number} ${data.title}\n\n${data.body ?? ''}`;
    }
    case 'create_issue_comment': {
      await octokit.issues.createComment({ owner: input.owner!, repo: input.repo!, issue_number: input.issue_number!, body: input.comment_body! });
      return `Comment posted on #${input.issue_number}`;
    }
    default:
      return 'Unknown github op';
  }
}
