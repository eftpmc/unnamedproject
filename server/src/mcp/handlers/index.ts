import { registerSpaceHandlers } from './spaces.js';
import { registerMemoryHandlers } from './memory.js';
import { registerKnowledgeHandlers } from './knowledge.js';
import { registerChatHandlers } from './chats.js';
import { registerGitHandlers } from './git.js';
import { registerConnectionHandlers } from './connections.js';
import { registerDocumentHandlers } from './documents.js';

registerSpaceHandlers();
registerMemoryHandlers();
registerKnowledgeHandlers();
registerChatHandlers();
registerGitHandlers();
registerConnectionHandlers();
registerDocumentHandlers();
