type Block =
  | { type: 'text'; content: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'image'; url: string; alt?: string; caption?: string }
  | { type: 'task-list'; tasks: { id: string; text: string; done: boolean }[] }
  | { type: 'callout'; variant: 'info' | 'warning' | 'success' | 'error'; content: string }
  | { type: 'file-browser' };

export const ITEM_TEMPLATES: Record<string, Block[]> = {
  document: [
    { type: 'text', content: '' },
  ],
  spec: [
    { type: 'heading', level: 1, text: 'Overview' },
    { type: 'callout', variant: 'info', content: 'Describe the problem this solves.' },
    { type: 'heading', level: 2, text: 'Approach' },
    { type: 'text', content: '' },
    { type: 'heading', level: 2, text: 'Success Criteria' },
    { type: 'task-list', tasks: [] },
    { type: 'heading', level: 2, text: 'Open Questions' },
    { type: 'task-list', tasks: [] },
  ],
  kanban: [
    { type: 'heading', level: 1, text: 'Tasks' },
    { type: 'heading', level: 2, text: 'To Do' },
    { type: 'task-list', tasks: [] },
    { type: 'heading', level: 2, text: 'In Progress' },
    { type: 'task-list', tasks: [] },
    { type: 'heading', level: 2, text: 'Done' },
    { type: 'task-list', tasks: [] },
  ],
  report: [
    { type: 'heading', level: 1, text: 'Report' },
    { type: 'text', content: '' },
    { type: 'heading', level: 2, text: 'Details' },
    { type: 'text', content: '' },
  ],
};

export const REPO_OVERVIEW_STARTER: Block[] = [
  { type: 'callout', variant: 'info', content: 'No overview yet. Ask the agent to describe this repo.' },
];
