import { registerTool } from '../registry.js';
import { createTrigger, deleteTrigger, getTrigger, listTriggersByProject } from '../../services/triggers.js';
import { nextCronRun } from '../../lib/cron.js';
import { createExecution, completeExecution, requestApproval } from '../../services/executor.js';
import { readFile } from '../../services/files.js';

function humanCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, , dow] = parts;
  if (dom === '*' && dow === '*' && hour !== '*' && min !== '*') {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Every day at ${h12}:${String(m).padStart(2, '0')} ${suffix} UTC`;
  }
  return cron;
}

export function registerTriggerHandlers(): void {
  registerTool({
    name: 'create_trigger',
    description: 'Create an automation trigger in a project. For kind=schedule, provide schedule_cron (UTC, 5-field cron) and playbook_id (a document with frontmatter type: workflow). When it fires, a chat starts pinned to the project seeded with the playbook body.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        kind: { type: 'string', enum: ['schedule', 'webhook', 'manual'] },
        schedule_cron: { type: 'string', description: '5-field cron, UTC, e.g. "0 8 * * *"' },
        playbook_id: { type: 'string', description: 'Document id of the type:workflow playbook' },
      },
      required: ['project_id', 'kind'],
    },
    handler: async (args, userId, sessionId) => {
      const cron = args.schedule_cron as string | undefined;
      let next: number | null = null;
      if (args.kind === 'schedule' && cron) {
        try {
          next = nextCronRun(cron, Math.floor(Date.now() / 1000));
        } catch {
          return 'Error: invalid schedule_cron expression';
        }
      }
      const executionId = createExecution(userId ?? 'system', null, null, 'create_trigger');
      let playbookTitle = 'Untitled Playbook';
      let playbookPreview: string | undefined;
      if (args.playbook_id) {
        try {
          const pb = await readFile(args.playbook_id as string);
          if (pb) { playbookTitle = pb.title ?? playbookTitle; playbookPreview = pb.body?.slice(0, 200) ?? undefined; }
        } catch { /* skip */ }
      }
      const schedule = cron ? humanCron(cron) : 'Manual / webhook';
      const decision = await requestApproval(executionId, userId ?? 'system', 'create_trigger', {
        session_id: sessionId,
        ui: { kind: 'trigger_preview', playbookTitle, schedule, cron: cron ?? '', preview: playbookPreview },
      }, 'user');
      if (decision.decision === 'rejected') {
        completeExecution(executionId, userId ?? 'system', 'error', 'User rejected trigger creation.');
        return 'Cancelled: user did not approve this trigger.';
      }
      const result = JSON.stringify(createTrigger({
        project_id: args.project_id as string,
        kind: args.kind as 'schedule' | 'webhook' | 'manual',
        schedule_cron: cron ?? null,
        playbook_id: args.playbook_id as string | undefined,
        next_run_at: next,
      }));
      completeExecution(executionId, userId ?? 'system', 'done', result);
      return result;
    },
  });

  registerTool({
    name: 'list_triggers',
    description: 'List automation triggers in a project.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'] },
    handler: async (args, userId) => JSON.stringify(listTriggersByProject(args.project_id as string, userId)),
  });

  registerTool({
    name: 'delete_trigger',
    description: 'Delete an automation trigger.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (args) => {
      if (!getTrigger(args.id as string)) return `Error: trigger ${args.id} not found`;
      deleteTrigger(args.id as string);
      return 'deleted';
    },
  });
}
