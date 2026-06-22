import { getAgentBudgets, getMonthlyUsage, getDailyUsage, recordAgentUsage, type AgentUsageTool } from '../db/index.js';
import { buildGraph } from './graphify.js';

export interface AgentPipelineCtx {
  userId: string;
  tool: AgentUsageTool;
  repoPath: string;
  projectId: string;
  /** Anthropic key used for the post-run graph rebuild, if any. */
  graphKey: string | null;
  result?: string;
  costUsd?: number;
}

export type AgentMiddleware = (ctx: AgentPipelineCtx, next: () => Promise<void>) => Promise<void>;

function compose(middleware: AgentMiddleware[]): (ctx: AgentPipelineCtx) => Promise<void> {
  return function run(ctx) {
    let index = -1;
    function dispatch(i: number): Promise<void> {
      if (i <= index) throw new Error('next() called multiple times');
      index = i;
      const fn = middleware[i];
      if (!fn) return Promise.resolve();
      return fn(ctx, () => dispatch(i + 1));
    }
    return dispatch(0);
  };
}

const TOOL_LABELS: Record<AgentUsageTool, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  lead_agent: 'Lead Agent',
  subagent: 'Sub-agent',
};

/** Hard-stops the run before it starts if the daily or monthly budget for this tool is already used up. */
export const budgetGate: AgentMiddleware = async (ctx, next) => {
  const dailyBudget = getAgentBudgets(ctx.userId, 'daily')[ctx.tool];
  if (dailyBudget !== null) {
    const spentToday = getDailyUsage(ctx.userId, ctx.tool);
    if (spentToday >= dailyBudget) {
      ctx.result = `Error: daily budget for ${TOOL_LABELS[ctx.tool]} ($${dailyBudget.toFixed(2)}) has been reached ($${spentToday.toFixed(2)} spent today). Use the other coding agent instead, or raise the daily budget in Settings.`;
      return;
    }
  }
  const budget = getAgentBudgets(ctx.userId)[ctx.tool];
  if (budget !== null) {
    const spent = getMonthlyUsage(ctx.userId, ctx.tool);
    if (spent >= budget) {
      ctx.result = `Error: monthly budget for ${TOOL_LABELS[ctx.tool]} ($${budget.toFixed(2)}) has been reached ($${spent.toFixed(2)} spent this month). Use the other coding agent instead, or raise the budget in Settings.`;
      return;
    }
  }
  await next();
};

/** Records actual spend after a successful run. */
export const recordUsage: AgentMiddleware = async (ctx, next) => {
  await next();
  if (ctx.costUsd) recordAgentUsage(ctx.userId, ctx.tool, ctx.costUsd);
};

/** Kicks off a knowledge-graph rebuild after a successful run. */
export const rebuildGraphAfter: AgentMiddleware = async (ctx, next) => {
  await next();
  if (ctx.result !== undefined && !ctx.result.startsWith('Error')) {
    buildGraph(ctx.repoPath, ctx.projectId, ctx.graphKey).catch(err =>
      console.error(`rebuild_graph after ${ctx.tool} failed for project ${ctx.projectId}:`, err)
    );
  }
};

/**
 * Runs ctx through the standard delegate-agent gates (budget check, usage
 * recording, graph rebuild) and then `runCore`, which performs the actual
 * agent invocation and must set ctx.result (and ctx.costUsd on success).
 */
export function runAgentPipeline(ctx: AgentPipelineCtx, runCore: () => Promise<void>): Promise<void> {
  return compose([budgetGate, recordUsage, rebuildGraphAfter, (c, _next) => runCore()])(ctx);
}
