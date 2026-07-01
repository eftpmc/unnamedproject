import { registerTool } from '../registry.js';
import fs from 'fs/promises';
import path from 'path';
import { appendFile, writeFile, writeBinaryFile, readFile, listFiles, tagFile, deleteFile, mimeTypeFromPath } from '../../services/files.js';
import { getProjectForUser } from '../../services/projects.js';
import { defaultAgentRuntimeRoot } from '../../lib/workspacePaths.js';

function decodeBase64(data: unknown): Buffer | string {
  if (typeof data !== 'string' || data.trim() === '') return 'Error: data_base64 is required';
  const normalized = data.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    return 'Error: data_base64 is not valid base64';
  }
  return Buffer.from(normalized, 'base64');
}

function resolveArtifactSource(sourcePath: string, sessionId: string | null): string | null {
  if (!sessionId) return null;
  if (path.isAbsolute(sourcePath)) return null;
  const root = path.resolve(defaultAgentRuntimeRoot(), 'agent-workspaces', sessionId);
  const resolved = path.resolve(root, sourcePath);
  if (!resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

export function registerFileHandlers(): void {
  registerTool({
    name: 'append_file',
    description: 'Append text to a project file without reading its current contents. Safe for large log files that would exceed context limits if read in full. Creates the file if it does not exist. Use instead of write_file when the goal is to add a new section at the end of an existing document.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        path: { type: 'string', description: 'Relative path within the project, e.g. opportunity-log.md' },
        entry: { type: 'string', description: 'Text to append. A newline separator is added automatically before the entry.' },
      },
      required: ['project_id', 'path', 'entry'],
    },
    handler: async (args, userId, sessionId) => {
      const project = getProjectForUser(args.project_id as string, userId);
      if (!project) return `Error: project ${args.project_id} not found`;
      return JSON.stringify(await appendFile({
        project_id: args.project_id as string,
        path: args.path as string,
        entry: args.entry as string,
        source_session_id: sessionId,
      }));
    },
  });

  registerTool({
    name: 'write_file',
    description: 'Create or overwrite a text file in a project. Tags are YAML key/values (set `type` and `status` for tracking). Body is the file content. Re-writing the same path updates it. For PDFs, images, archives, or other binary artifacts, use write_binary_file or promote_artifact.',
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
    handler: async (args, userId, sessionId) => {
      const project = getProjectForUser(args.project_id as string, userId);
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
    name: 'write_binary_file',
    description: 'Create or overwrite a binary artifact in a project from base64 data. Use for generated PDFs, images, archives, spreadsheets, and other non-text outputs. Verify with list_files before claiming the artifact was added.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        path: { type: 'string', description: 'Relative path within the project, e.g. resumes/resume.pdf' },
        title: { type: 'string' },
        mime_type: { type: 'string', description: 'MIME type, e.g. application/pdf or image/png. Inferred from path when omitted.' },
        tags: { type: 'object', description: 'YAML key/values; include type and status when relevant' },
        data_base64: { type: 'string', description: 'Base64-encoded file bytes' },
      },
      required: ['project_id', 'path', 'title', 'data_base64'],
    },
    handler: async (args, userId, sessionId) => {
      const project = getProjectForUser(args.project_id as string, userId);
      if (!project) return `Error: project ${args.project_id} not found`;
      const decoded = decodeBase64(args.data_base64);
      if (typeof decoded === 'string') return decoded;
      const record = await writeBinaryFile({
        project_id: args.project_id as string,
        path: args.path as string,
        title: args.title as string,
        mime_type: (args.mime_type as string | undefined) ?? mimeTypeFromPath(args.path as string),
        data: decoded,
        tags: args.tags as Record<string, unknown> | undefined,
        source_session_id: sessionId,
      });
      return JSON.stringify(record);
    },
  });

  registerTool({
    name: 'promote_artifact',
    description: 'Copy a locally generated artifact into a project file store. Use after compiling/exporting a PDF, image, archive, or other artifact in session/outputs or another workspace path. Relative source_path values resolve from the current session workspace root. Do not leave final outputs on Desktop or Downloads; promote them into the active project and verify with list_files.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        source_path: { type: 'string', description: 'Path to the local artifact created by the agent. Relative paths resolve from the session workspace root, e.g. session/outputs/resume.pdf' },
        path: { type: 'string', description: 'Relative destination path within the project, e.g. resumes/resume.pdf' },
        title: { type: 'string' },
        mime_type: { type: 'string', description: 'MIME type. Inferred from destination path when omitted.' },
        tags: { type: 'object', description: 'YAML key/values; include type and status when relevant' },
      },
      required: ['project_id', 'source_path', 'path', 'title'],
    },
    handler: async (args, userId, sessionId) => {
      const project = getProjectForUser(args.project_id as string, userId);
      if (!project) return `Error: project ${args.project_id} not found`;
      const sourcePath = resolveArtifactSource(args.source_path as string, sessionId);
      if (!sourcePath) return `Error: source_path must be a relative path within the session workspace (e.g. session/outputs/resume.pdf)`;
      let data: Buffer;
      try {
        const stat = await fs.stat(sourcePath);
        if (!stat.isFile()) return `Error: source_path is not a file: ${sourcePath}`;
        data = await fs.readFile(sourcePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: could not read source_path ${sourcePath}: ${message}`;
      }
      const record = await writeBinaryFile({
        project_id: args.project_id as string,
        path: args.path as string,
        title: args.title as string,
        mime_type: (args.mime_type as string | undefined) ?? mimeTypeFromPath(args.path as string),
        data,
        tags: args.tags as Record<string, unknown> | undefined,
        source_session_id: sessionId,
      });
      return JSON.stringify(record);
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
    handler: async (args, userId) => {
      const project = getProjectForUser(args.project_id as string, userId);
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
