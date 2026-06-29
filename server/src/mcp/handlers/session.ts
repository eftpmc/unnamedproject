import { registerTool } from '../registry.js';
import { recordSessionStateEvent } from '../../services/session-state.js';

export function registerSessionHandlers(): void {
  registerTool({
    name: 'checkpoint_session',
    description: 'Save structured progress to the session state so it can be recovered after a context reset. Call after completing any significant piece of work, before committing, or when hitting a blocker.',
    inputSchema: {
      type: 'object',
      properties: {
        completed: { type: 'string', description: 'What was just accomplished in this turn' },
        current_focus: { type: 'string', description: 'What the agent is actively working on right now' },
        open_tasks: { type: 'array', items: { type: 'string' }, description: 'What still needs to be done' },
        blockers: { type: 'array', items: { type: 'string' }, description: 'What is blocked or requires user input before continuing' },
        next_action: { type: 'string', description: 'The specific next step when work resumes' },
        files_changed: { type: 'array', items: { type: 'string' }, description: 'Files that were created or modified' },
        goal: { type: 'string', description: 'The overall session goal — only needed once, not every turn' },
      },
    },
    handler: async (args, _userId, sessionId) => {
      if (!sessionId) return 'No active session to checkpoint.';

      const event: Parameters<typeof recordSessionStateEvent>[1] = {};
      if (typeof args.goal === 'string' && args.goal.trim()) event.goal = args.goal;
      if (typeof args.current_focus === 'string' && args.current_focus.trim()) event.current_focus = args.current_focus;
      if (typeof args.next_action === 'string' && args.next_action.trim()) event.next_action = args.next_action;
      if (typeof args.completed === 'string' && args.completed.trim()) event.facts = [args.completed];
      if (Array.isArray(args.open_tasks)) {
        event.open_tasks = (args.open_tasks as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
      }
      if (Array.isArray(args.blockers)) {
        event.blockers = (args.blockers as unknown[]).filter((b): b is string => typeof b === 'string' && b.trim().length > 0);
      }
      if (Array.isArray(args.files_changed)) {
        event.files_touched = (args.files_changed as unknown[]).filter((f): f is string => typeof f === 'string' && f.trim().length > 0);
      }

      recordSessionStateEvent(sessionId, event);
      return 'Session checkpoint saved.';
    },
  });
}
