import { registerTool } from '../registry.js';
import { createExecution, completeExecution, requestApproval } from '../../services/executor.js';
import * as Gmail from '../../services/gmail.js';

const BATCH_CAP = 25;
const sendCounts = new Map<string, number>();

function batchCapError(ids: string[]): string | null {
  return ids.length > BATCH_CAP ? `Batch exceeds cap of ${BATCH_CAP}. Provide at most ${BATCH_CAP} thread IDs.` : null;
}

function sendCapError(sessionId: string | null): string | null {
  if (!sessionId) return null;
  return (sendCounts.get(sessionId) ?? 0) >= 5 ? 'Send cap (5 per session) reached.' : null;
}

function incrementSends(sessionId: string | null): void {
  if (sessionId) sendCounts.set(sessionId, (sendCounts.get(sessionId) ?? 0) + 1);
}

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
    if (decision === 'rejected') {
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

export function registerGmailHandlers(): void {
  registerTool({
    name: 'gmail_search',
    description: 'Search Gmail threads. Returns thread IDs, subjects, senders, dates, and snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g. "from:foo@bar.com is:unread")' },
        max_results: { type: 'number', description: 'Max threads to return (1-25, default 10)' },
      },
      required: ['query'],
    },
    handler: async (args, userId) => {
      try {
        return await Gmail.searchThreads(userId, args.query as string, (args.max_results as number | undefined) ?? 10);
      } catch (e) { return `Error: ${(e as Error).message}`; }
    },
  });

  registerTool({
    name: 'gmail_get_thread',
    description: 'Get the full content of a Gmail thread by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        thread_id: { type: 'string' },
      },
      required: ['thread_id'],
    },
    handler: async (args, userId) => {
      try {
        return await Gmail.getThread(userId, args.thread_id as string);
      } catch (e) { return `Error: ${(e as Error).message}`; }
    },
  });

  registerTool({
    name: 'gmail_list_labels',
    description: 'List all Gmail labels for the connected account.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async (args, userId) => {
      try {
        return await Gmail.listLabels(userId);
      } catch (e) { return `Error: ${(e as Error).message}`; }
    },
  });

  registerTool({
    name: 'gmail_create_draft',
    description: 'Create a Gmail draft without sending.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        in_reply_to: { type: 'string', description: 'Message-ID header of the message being replied to' },
      },
      required: ['to', 'subject', 'body'],
    },
    handler: async (args, userId) => {
      try {
        return await Gmail.createDraft(userId, args.to as string, args.subject as string, args.body as string, args.in_reply_to as string | undefined);
      } catch (e) { return `Error: ${(e as Error).message}`; }
    },
  });

  registerTool({
    name: 'gmail_send_message',
    description: 'Send a new email. Requires user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        in_reply_to: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
    handler: async (args, userId, sessionId) => {
      const capErr = sendCapError(sessionId);
      if (capErr) return capErr;
      return withApproval(userId, 'gmail_send_message', 'Send email', {
        to: args.to, subject: args.subject, preview: (args.body as string).slice(0, 300),
      }, async () => {
        const result = await Gmail.sendMessage(userId, args.to as string, args.subject as string, args.body as string, args.in_reply_to as string | undefined);
        incrementSends(sessionId);
        return result;
      });
    },
  });

  registerTool({
    name: 'gmail_send_draft',
    description: 'Send an existing Gmail draft. Requires user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        draft_id: { type: 'string' },
      },
      required: ['draft_id'],
    },
    handler: async (args, userId, sessionId) => {
      const capErr = sendCapError(sessionId);
      if (capErr) return capErr;
      return withApproval(userId, 'gmail_send_draft', 'Send draft', { draft_id: args.draft_id }, async () => {
        const result = await Gmail.sendDraft(userId, args.draft_id as string);
        incrementSends(sessionId);
        return result;
      });
    },
  });

  registerTool({
    name: 'gmail_trash_threads',
    description: 'Move threads to trash. Requires user approval. Max 25 threads.',
    inputSchema: {
      type: 'object',
      properties: {
        thread_ids: { type: 'array', items: { type: 'string' }, maxItems: 25 },
      },
      required: ['thread_ids'],
    },
    handler: async (args, userId) => {
      const ids = args.thread_ids as string[];
      const capErr = batchCapError(ids);
      if (capErr) return capErr;
      return withApproval(userId, 'gmail_trash_threads', `Trash ${ids.length} thread(s)`, { count: ids.length, thread_ids: ids }, () => Gmail.trashThreads(userId, ids));
    },
  });

  registerTool({
    name: 'gmail_archive_threads',
    description: 'Archive threads (remove from inbox). Requires user approval. Max 25 threads.',
    inputSchema: {
      type: 'object',
      properties: {
        thread_ids: { type: 'array', items: { type: 'string' }, maxItems: 25 },
      },
      required: ['thread_ids'],
    },
    handler: async (args, userId) => {
      const ids = args.thread_ids as string[];
      const capErr = batchCapError(ids);
      if (capErr) return capErr;
      return withApproval(userId, 'gmail_archive_threads', `Archive ${ids.length} thread(s)`, { count: ids.length, thread_ids: ids }, () => Gmail.archiveThreads(userId, ids));
    },
  });

  registerTool({
    name: 'gmail_modify_labels',
    description: 'Add or remove labels on threads. Use label IDs from gmail_list_labels. Requires user approval. Max 25 threads.',
    inputSchema: {
      type: 'object',
      properties: {
        thread_ids: { type: 'array', items: { type: 'string' }, maxItems: 25 },
        add_label_ids: { type: 'array', items: { type: 'string' } },
        remove_label_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['thread_ids'],
    },
    handler: async (args, userId) => {
      const ids = args.thread_ids as string[];
      const capErr = batchCapError(ids);
      if (capErr) return capErr;
      const add = (args.add_label_ids as string[] | undefined) ?? [];
      const remove = (args.remove_label_ids as string[] | undefined) ?? [];
      return withApproval(userId, 'gmail_modify_labels', `Modify labels on ${ids.length} thread(s)`, {
        count: ids.length, thread_ids: ids, add_label_ids: add, remove_label_ids: remove,
      }, () => Gmail.modifyLabels(userId, ids, add, remove));
    },
  });
}
