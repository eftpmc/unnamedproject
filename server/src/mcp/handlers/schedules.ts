import { registerTool } from '../registry.js';
import {
  getScheduledTasksForUser,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
} from '../../db/index.js';

export function registerScheduleHandlers(): void {
  registerTool({
    name: 'list_scheduled_tasks',
    description: 'List all scheduled tasks',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => {
      const tasks = getScheduledTasksForUser(userId);
      return JSON.stringify(
        tasks.map(t => ({
          id: t.id,
          type: t.type,
          prompt: t.prompt,
          interval_hours: t.interval_hours,
          enabled: !!t.enabled,
          next_run_at: t.next_run_at,
          last_run_at: t.last_run_at,
          pinned_space_id: t.pinned_space_id,
        })),
        null,
        2,
      );
    },
  });

  registerTool({
    name: 'create_scheduled_task',
    description: 'Create a new scheduled task. Set pinned_space_id so the task runs with full space context (items, workspace.md, capabilities).',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        prompt: { type: 'string' },
        interval_hours: { type: 'number' },
        pinned_space_id: { type: 'string', description: 'Space to pin so the task has full project context when it runs' },
      },
      required: ['type', 'interval_hours'],
    },
    handler: async (args, userId) => {
      const id = createScheduledTask(
        userId,
        args.type as string,
        args.interval_hours as number,
        args.prompt as string | undefined,
        args.pinned_space_id as string | undefined,
      );
      return JSON.stringify({ id, type: args.type, interval_hours: args.interval_hours, enabled: true, pinned_space_id: args.pinned_space_id ?? null });
    },
  });

  registerTool({
    name: 'update_scheduled_task',
    description: 'Enable/disable or change interval for a scheduled task',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        enabled: { type: 'boolean' },
        interval_hours: { type: 'number' },
      },
      required: ['task_id'],
    },
    handler: async (args, userId) => {
      updateScheduledTask(args.task_id as string, userId, {
        enabled: args.enabled as boolean | undefined,
        interval_hours: args.interval_hours as number | undefined,
      });
      return 'Scheduled task updated';
    },
  });

  registerTool({
    name: 'delete_scheduled_task',
    description: 'Delete a scheduled task',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
    handler: async (args, userId) => {
      const deleted = deleteScheduledTask(args.task_id as string, userId);
      return deleted ? 'Scheduled task deleted' : `Error: scheduled task ${args.task_id} not found`;
    },
  });
}
