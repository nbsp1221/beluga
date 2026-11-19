import { type Plugin, createRuntime } from '@workspace/runtime';
import { chatClient } from '../features/chat/plugin.js';
import { createConversationPlugin } from '../features/conversation/plugin.js';
import { createFilesPlugin } from '../features/files/plugin.js';
import { createTrajectoryPlugin } from '../features/trajectory/plugin.js';
import { createWorkbenchPlugin } from '../workbench/plugin.js';

export function createClientProduct({
  connected,
  data,
  defaultSidebarOpen,
  plugins = [],
}: {
  connected: boolean;
  data: Plugin;
  defaultSidebarOpen?: boolean;
  plugins?: readonly Plugin[];
}) {
  return createRuntime([
    createWorkbenchPlugin(defaultSidebarOpen),
    createConversationPlugin(connected),
    chatClient,
    createFilesPlugin(connected),
    createTrajectoryPlugin(connected),
    data,
    ...plugins,
  ]);
}
