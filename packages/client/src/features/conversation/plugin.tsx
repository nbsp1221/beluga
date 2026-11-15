import type { Plugin } from '@workspace/runtime';
import { FolderGit2, MessageCircle } from 'lucide-react';
import { Conversation } from './shell/conversation.js';
import { ConversationSidebar } from './shell/sidebar.js';
import { createConversationViews } from './view-registry.js';
import { WorkspaceSettings } from './workspace-settings.js';
import '../../workbench/contract.js';

export function createConversationPlugin(connected: boolean): Plugin {
  return {
    id: 'conversation',
    requires: [
      'destinations',
      'conversation',
      'workspaces',
      ...(connected ? (['agentPresets', 'modelProviders'] as const) : []),
    ],
    provides: ['conversationViews'],
    setup(context) {
      const client = context.get('conversation');
      const workspaces = context.get('workspaces');
      const agentPresets = connected ? context.get('agentPresets') : undefined;
      const modelProviders = connected ? context.get('modelProviders') : undefined;
      const destinations = context.get('destinations');
      const views = createConversationViews();
      context.provide('conversationViews', views);
      if (connected) {
        context.onDispose(
          destinations.registerSetting({
            id: 'workspaces',
            label: 'Workspaces',
            icon: FolderGit2,
            order: 1,
            component: WorkspaceSettings,
          }),
        );
      }
      context.onDispose(
        destinations.register({
          id: 'chats',
          label: 'Chats',
          icon: MessageCircle,
          path: '/chat',
          order: 0,
          component: () => (
            <Conversation
              client={client}
              views={views}
              workspaceClient={workspaces}
              agentPresets={agentPresets}
              modelProviders={modelProviders}
            />
          ),
          sidebar: {
            component: () => <ConversationSidebar client={client} workspaceClient={workspaces} />,
            description: 'Workspaces and sessions',
          },
        }),
      );
    },
  };
}
