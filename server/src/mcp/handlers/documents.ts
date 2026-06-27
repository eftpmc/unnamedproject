import { registerTool } from '../registry.js';
import { writeDocument, readDocument, listDocuments, patchFrontmatter } from '../../services/documents.js';

export function registerDocumentHandlers(): void {
  registerTool({
    name: 'write_document',
    description: 'Create or overwrite a markdown document in a space. Frontmatter is YAML key/values (set `type` and `status` for tracking). Body is markdown. Re-writing the same path updates it.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        path: { type: 'string', description: 'Relative path within the space, e.g. application-acme.md' },
        title: { type: 'string' },
        frontmatter: { type: 'object', description: 'YAML key/values; include type and status when relevant' },
        body: { type: 'string', description: 'Markdown body' },
      },
      required: ['space_id', 'path', 'title', 'body'],
    },
    handler: async (args, _userId, sessionId) => JSON.stringify(await writeDocument({
      space_id: args.space_id as string,
      path: args.path as string,
      title: args.title as string,
      frontmatter: args.frontmatter as Record<string, unknown> | undefined,
      body: args.body as string,
      source_session_id: sessionId,
    })),
  });

  registerTool({
    name: 'read_document',
    description: 'Read a document by id, including its markdown body and parsed frontmatter.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (args) => {
      const doc = await readDocument(args.id as string);
      return doc ? JSON.stringify(doc) : `Error: document ${args.id} not found`;
    },
  });

  registerTool({
    name: 'list_documents',
    description: 'List documents in a space. Filter by type and/or exact frontmatter field values. A tracker view is just list_documents grouped by status.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        type: { type: 'string' },
        frontmatter: { type: 'object', description: 'Exact-match filters, e.g. { status: "applied" }' },
      },
      required: ['space_id'],
    },
    handler: async (args) => JSON.stringify(listDocuments(
      args.space_id as string,
      (args.type || args.frontmatter) ? { type: args.type as string | undefined, frontmatter: args.frontmatter as Record<string, unknown> | undefined } : undefined,
    )),
  });

  registerTool({
    name: 'patch_frontmatter',
    description: 'Merge a patch into a document\'s frontmatter without rewriting the body. Use for cheap status/field updates.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, patch: { type: 'object' } },
      required: ['id', 'patch'],
    },
    handler: async (args) => {
      const updated = await patchFrontmatter(args.id as string, args.patch as Record<string, unknown>);
      return updated ? JSON.stringify(updated) : `Error: document ${args.id} not found`;
    },
  });
}
