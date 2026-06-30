import { registerTool } from '../registry.js';
import { writeFile, readFile, listFiles, tagFile, deleteFile } from '../../services/files.js';
import { getDb } from '../../db/index.js';

export function registerFileHandlers(): void {
  registerTool({
    name: 'write_file',
    description: 'Create or overwrite a file (.md or .txt) in a project. Tags are YAML key/values (set `type` and `status` for tracking). Body is the file content. Re-writing the same path updates it.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        path: { type: 'string', description: 'Relative path within the project, e.g. resume.md or notes.txt' },
        title: { type: 'string' },
        tags: { type: 'object', description: 'YAML key/values; include type and status when relevant' },
        body: { type: 'string', description: 'File content' },
      },
      required: ['project_id', 'path', 'title', 'body'],
    },
    handler: async (args, _userId, sessionId) => {
      const project = getDb().prepare('SELECT id FROM projects WHERE id = ?').get(args.project_id as string) as { id: string } | undefined;
      if (!project) return `Error: project ${args.project_id} not found`;
      return JSON.stringify(await writeFile({
        project_id: args.project_id as string,
        path: args.path as string,
        title: args.title as string,
        tags: args.tags as Record<string, unknown> | undefined,
        body: args.body as string,
        source_session_id: sessionId,
      }));
    },
  });

  registerTool({
    name: 'read_file',
    description: 'Read a file by id, including its content body and parsed tags. Binary files (images, PDFs) return body: null.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (args) => {
      const file = await readFile(args.id as string);
      return file ? JSON.stringify(file) : `Error: file ${args.id} not found`;
    },
  });

  registerTool({
    name: 'list_files',
    description: 'List files in a project. Filter by type and/or exact tag field values.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        type: { type: 'string' },
        tags: { type: 'object', description: 'Exact-match filters, e.g. { status: "applied" }' },
      },
      required: ['project_id'],
    },
    handler: async (args) => {
      const project = getDb().prepare('SELECT id FROM projects WHERE id = ?').get(args.project_id as string) as { id: string } | undefined;
      if (!project) return `Error: project ${args.project_id} not found`;
      return JSON.stringify(listFiles(
        args.project_id as string,
        (args.type || args.tags) ? { type: args.type as string | undefined, tags: args.tags as Record<string, unknown> | undefined } : undefined,
      ));
    },
  });

  registerTool({
    name: 'delete_file',
    description: 'Permanently delete a file by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: async (args) => {
      const ok = await deleteFile(args.id as string);
      return ok ? 'deleted' : `Error: file ${args.id} not found`;
    },
  });

  registerTool({
    name: 'tag_file',
    description: 'Merge tags into a file without rewriting the body. Works for both text and binary files. Use to update type, status, or any custom metadata.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, tags: { type: 'object' } },
      required: ['id', 'tags'],
    },
    handler: async (args) => {
      const updated = await tagFile(args.id as string, args.tags as Record<string, unknown>);
      return updated ? JSON.stringify(updated) : `Error: file ${args.id} not found`;
    },
  });
}
