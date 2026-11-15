import type { Plugin } from '@workspace/runtime';
import { createDemoConversation } from '../features/conversation/data/demo.js';
import { createDemoWorkspaces } from '../features/workspaces/data/demo.js';

export const demoData: Plugin = {
  id: 'demo-data',
  provides: ['conversation', 'workspaces'],
  setup(context) {
    const workspaces = createDemoWorkspaces();
    context.provide('workspaces', workspaces);
    context.provide('conversation', createDemoConversation(workspaces));
  },
};
