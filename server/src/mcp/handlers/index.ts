import { registerSpaceHandlers } from './spaces.js';
import { registerMemoryHandlers } from './memory.js';
import { registerKnowledgeHandlers } from './knowledge.js';
import { registerChatHandlers } from './chats.js';
import { registerGitHandlers } from './git.js';
import { registerConnectionHandlers } from './connections.js';

registerSpaceHandlers();
registerMemoryHandlers();
registerKnowledgeHandlers();
registerChatHandlers();
registerGitHandlers();
registerConnectionHandlers();
