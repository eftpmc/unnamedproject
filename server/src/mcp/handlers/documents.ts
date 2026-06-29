import fs from 'fs/promises';
import path from 'path';
import { registerTool } from '../registry.js';
import { writeDocument, writeBinaryDocument, readDocument, listDocuments, patchFrontmatter, deleteDocument } from '../../services/documents.js';
import { getDb } from '../../db/index.js';

interface DbAttachment {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w.-]/g, '') || 'file';
}

function uniquePath(spaceId: string, base: string): string {
  let p = base;
  let counter = 2;
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  while (getDb().prepare('SELECT id FROM documents WHERE space_id = ? AND path = ?').get(spaceId, p)) {
    p = `${stem}-${counter}${ext}`;
    counter++;
  }
  return p;
}

export function registerDocumentHandlers(): void {
  registerTool({
    name: 'write_document',
    description: 'Create or overwrite a text document (.md or .txt) in a project. Frontmatter is YAML key/values (set `type` and `status` for tracking). Body is the file content. Re-writing the same path updates it.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        path: { type: 'string', description: 'Relative path within the project, e.g. resume.md or notes.txt' },
        title: { type: 'string' },
        frontmatter: { type: 'object', description: 'YAML key/values; include type and status when relevant' },
        body: { type: 'string', description: 'File content' },
      },
      required: ['project_id', 'path', 'title', 'body'],
    },
    handler: async (args, _userId, sessionId) => {
      const project = getDb().prepare('SELECT space_id FROM projects WHERE id = ?').get(args.project_id as string) as { space_id: string } | undefined;
      if (!project) return `Error: project ${args.project_id} not found`;
      return JSON.stringify(await writeDocument({
        space_id: project.space_id,
        path: args.path as string,
        title: args.title as string,
        frontmatter: args.frontmatter as Record<string, unknown> | undefined,
        body: args.body as string,
        source_session_id: sessionId,
      }));
    },
  });

  registerTool({
    name: 'save_attachment_to_project',
    description: 'File a chat attachment (PDF, image, or any uploaded file) into a project as a document. Use this when the user uploads a file and wants it saved to a project library.',
    inputSchema: {
      type: 'object',
      properties: {
        attachment_id: { type: 'string', description: 'The attachment ID from the chat message' },
        project_id: { type: 'string' },
        title: { type: 'string', description: 'Display title; defaults to the filename without extension' },
        path: { type: 'string', description: 'Path within the project; defaults to the original filename (slugified)' },
        frontmatter: { type: 'object', description: 'Optional metadata key/values, e.g. { type: "resume" }' },
      },
      required: ['attachment_id', 'project_id'],
    },
    handler: async (args, _userId, sessionId) => {
      const attachment = getDb()
        .prepare('SELECT id, filename, mime_type, size_bytes, storage_path FROM message_attachments WHERE id = ?')
        .get(args.attachment_id as string) as DbAttachment | undefined;
      if (!attachment) return `Error: attachment ${args.attachment_id} not found`;

      const project = getDb()
        .prepare('SELECT space_id FROM projects WHERE id = ?')
        .get(args.project_id as string) as { space_id: string } | undefined;
      if (!project) return `Error: project ${args.project_id} not found`;

      const filename = attachment.filename;
      const title = (args.title as string | undefined)?.trim()
        || path.basename(filename, path.extname(filename));
      const targetPath = uniquePath(
        project.space_id,
        (args.path as string | undefined) || slugify(filename),
      );

      const data = await fs.readFile(attachment.storage_path);
      return JSON.stringify(await writeBinaryDocument({
        space_id: project.space_id,
        path: targetPath,
        title,
        mime_type: attachment.mime_type,
        data,
        frontmatter: args.frontmatter as Record<string, unknown> | undefined,
        source_session_id: sessionId,
      }));
    },
  });

  registerTool({
    name: 'read_document',
    description: 'Read a document by id, including its content body and parsed frontmatter. Binary files (images, PDFs) return body: null.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (args) => {
      const doc = await readDocument(args.id as string);
      return doc ? JSON.stringify(doc) : `Error: document ${args.id} not found`;
    },
  });

  registerTool({
    name: 'list_documents',
    description: 'List documents in a project. Filter by type and/or exact frontmatter field values.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        type: { type: 'string' },
        frontmatter: { type: 'object', description: 'Exact-match filters, e.g. { status: "applied" }' },
      },
      required: ['project_id'],
    },
    handler: async (args) => {
      const project = getDb().prepare('SELECT space_id FROM projects WHERE id = ?').get(args.project_id as string) as { space_id: string } | undefined;
      if (!project) return `Error: project ${args.project_id} not found`;
      return JSON.stringify(listDocuments(
        project.space_id,
        (args.type || args.frontmatter) ? { type: args.type as string | undefined, frontmatter: args.frontmatter as Record<string, unknown> | undefined } : undefined,
      ));
    },
  });

  registerTool({
    name: 'delete_document',
    description: 'Permanently delete a document by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: async (args) => {
      const ok = await deleteDocument(args.id as string);
      return ok ? 'deleted' : `Error: document ${args.id} not found`;
    },
  });

  registerTool({
    name: 'patch_frontmatter',
    description: 'Merge a patch into a document\'s frontmatter without rewriting the body. Works for both text and binary documents.',
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
