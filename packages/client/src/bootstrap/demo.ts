import type { Plugin } from '@workspace/runtime';
import type { ConversationClient } from '../features/conversation/contract.js';
import type { WorkspaceClient } from '../features/workspaces/contract.js';
import { createDemoConversation } from '../features/conversation/data/demo.js';
import { createDemoWorkspaces } from '../features/workspaces/data/demo.js';

export type { AssistantMessagePart, Message, Session } from '../features/conversation/contract.js';
export { createDemoConversation };

export function createDemoData(
  createConversation: (workspaces: WorkspaceClient) => ConversationClient = createDemoConversation,
): Plugin {
  return {
    id: 'demo-data',
    provides: ['conversation', 'workspaces'],
    setup(context) {
      const workspaces = createDemoWorkspaces();
      context.provide('workspaces', workspaces);
      context.provide('conversation', createConversation(workspaces));
    },
  };
}

export const demoData = createDemoData();
