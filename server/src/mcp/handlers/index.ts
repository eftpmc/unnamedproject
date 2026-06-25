import { registerSpaceHandlers } from './spaces.js';
import { registerItemHandlers } from './items.js';
import { registerMemoryHandlers } from './memory.js';
import { registerKnowledgeHandlers } from './knowledge.js';
import { registerChatHandlers } from './chats.js';
import { registerGitHandlers } from './git.js';
import { registerConnectionHandlers } from './connections.js';
import { registerScheduleHandlers } from './schedules.js';

registerSpaceHandlers();
registerItemHandlers();
registerMemoryHandlers();
registerKnowledgeHandlers();
registerChatHandlers();
registerGitHandlers();
registerConnectionHandlers();
registerScheduleHandlers();
