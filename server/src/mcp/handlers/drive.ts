import { registerTool } from '../registry.js';
import { createExecution, completeExecution, requestApproval } from '../../services/executor.js';
import * as Drive from '../../services/drive.js';

async function withApproval(
  userId: string,
  tool: string,
  action: string,
  payload: Record<string, unknown>,
  fn: () => Promise<string>,
): Promise<string> {
  const executionId = createExecution(userId, null, null, tool);
  try {
    const decision = await requestApproval(executionId, userId, action, payload);
    if (decision.decision === 'rejected') {
      completeExecution(executionId, userId, 'error', 'Not approved.');
      return 'Not approved.';
    }
    const result = await fn();
    completeExecution(executionId, userId, 'done', result);
    return result;
  } catch (e) {
    const msg = `Error: ${(e as Error).message}`;
    completeExecution(executionId, userId, 'error', msg);
    return msg;
  }
}

export function registerDriveHandlers(): void {
  registerTool({
    name: 'drive_list_files',
    description: 'List files in Google Drive, optionally filtered by a query. Returns file IDs, names, types, and modification times.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Drive search query (e.g. "name contains \'report\'" or "mimeType=\'application/vnd.google-apps.document\'"). Omit to list recent files.' },
        max_results: { type: 'number', description: 'Max files to return (1-50, default 20)' },
        account: { type: 'string', description: 'Drive account label (defaults to first connected)' },
      },
    },
    handler: async (args, userId) => {
      try {
        return await Drive.listFiles(userId, args.query as string | undefined, (args.max_results as number | undefined) ?? 20, args.account as string | undefined);
      } catch (e) { return `Error: ${(e as Error).message}`; }
    },
  });

  registerTool({
    name: 'drive_get_file_content',
    description: 'Read the content of a Google Drive file by ID. Supports Docs (exported as text), Sheets (exported as CSV), and plain text files.',
    inputSchema: {
      type: 'object',
      properties: {
        file_id: { type: 'string' },
        account: { type: 'string', description: 'Drive account label (defaults to first connected)' },
      },
      required: ['file_id'],
    },
    handler: async (args, userId) => {
      try {
        return await Drive.getFileContent(userId, args.file_id as string, args.account as string | undefined);
      } catch (e) { return `Error: ${(e as Error).message}`; }
    },
  });

  registerTool({
    name: 'drive_create_file',
    description: 'Create a new plain text file in Google Drive. Requires user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'File name (include extension, e.g. "notes.txt")' },
        content: { type: 'string', description: 'File content' },
        folder_id: { type: 'string', description: 'Optional parent folder ID' },
        account: { type: 'string', description: 'Drive account label (defaults to first connected)' },
      },
      required: ['name', 'content'],
    },
    handler: async (args, userId) => {
      return withApproval(userId, 'drive_create_file', 'Create Drive file', {
        name: args.name,
        preview: (args.content as string).slice(0, 200),
      }, () => Drive.createFile(userId, args.name as string, args.content as string, args.folder_id as string | undefined, args.account as string | undefined));
    },
  });
}
