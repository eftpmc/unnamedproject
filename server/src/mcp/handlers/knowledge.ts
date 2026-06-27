import { registerTool } from '../registry.js';
import { runProjectQuery } from '../../tools/project_query.js';
import { buildGraph } from '../../services/graphify.js';

export function registerKnowledgeHandlers(): void {
  registerTool({
    name: 'project_query',
    description: 'Ask a question about a repo using the knowledge graph',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        project_id: { type: 'string' },
        question: { type: 'string' },
      },
      required: ['space_id', 'project_id', 'question'],
    },
    handler: async (args, userId) => {
      return runProjectQuery(
        { space_id: args.space_id as string, item_id: args.project_id as string, question: args.question as string },
        userId,
      );
    },
  });

  registerTool({
    name: 'rebuild_graph',
    description: 'Rebuild the knowledge graph for a repo project',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        project_id: { type: 'string' },
      },
      required: ['space_id', 'project_id'],
    },
    handler: async (args) => {
      const { getProject } = await import('../../services/projects.js');
      const project = getProject(args.project_id as string);
      if (!project || project.space_id !== args.space_id) {
        return `Error: repo project ${args.project_id} not found in space ${args.space_id}`;
      }
      await buildGraph(project.repo_path, project.id);
      return 'Knowledge graph rebuilt successfully.';
    },
  });
}
