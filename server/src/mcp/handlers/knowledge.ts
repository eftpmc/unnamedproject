import { registerTool } from '../registry.js';
import { runProjectQuery } from '../../tools/project_query.js';
import { buildGraph, searchGraph } from '../../services/graphify.js';

export function registerKnowledgeHandlers(): void {
  registerTool({
    name: 'project_query',
    description: 'Ask a question about a repo using the knowledge graph',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        question: { type: 'string' },
      },
      required: ['project_id', 'question'],
    },
    handler: async (args, userId) => {
      return runProjectQuery(
        { project_id: args.project_id as string, question: args.question as string },
        userId,
      );
    },
  });

  registerTool({
    name: 'search_files',
    description: 'Find files in a repo by semantic similarity to a query. Returns file paths, exported symbols, and a preview of each file — no LLM call. Use for: "where is X defined", "which files handle Y", "find the auth middleware". Use project_query instead when you need an interpreted answer across many files.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        query: { type: 'string', description: 'Natural language description, symbol name, or file topic' },
        limit: { type: 'number', description: 'Max results to return (default 10, max 20)' },
      },
      required: ['project_id', 'query'],
    },
    handler: async (args) => {
      const { getProject } = await import('../../services/projects.js');
      const project = getProject(args.project_id as string);
      if (!project) return `Error: project ${args.project_id} not found`;
      const limit = Math.min(Number(args.limit ?? 10), 20);
      return searchGraph(args.query as string, project.repo_path, limit);
    },
  });

  registerTool({
    name: 'rebuild_graph',
    description: 'Rebuild the knowledge graph for a repo project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
      },
      required: ['project_id'],
    },
    handler: async (args) => {
      const { getProject } = await import('../../services/projects.js');
      const project = getProject(args.project_id as string);
      if (!project) return `Error: project ${args.project_id} not found`;
      await buildGraph(project.repo_path, project.id);
      return 'Knowledge graph rebuilt successfully.';
    },
  });
}
