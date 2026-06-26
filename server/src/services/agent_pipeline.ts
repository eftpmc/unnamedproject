import { recordAgentUsage, type AgentUsageTool } from '../db/index.js';
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
  return compose([recordUsage, rebuildGraphAfter, (c, _next) => runCore()])(ctx);
}
