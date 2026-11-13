import { agentPresetsClient } from '@workspace/client/agent-presets';
import { chatClient } from '@workspace/client/chat';
import { createConversationPlugin } from '@workspace/client/conversation';
import { filesClient } from '@workspace/client/files';
import { modelProvidersClient } from '@workspace/client/model-providers';
import { createTrajectoryPlugin } from '@workspace/client/trajectory';
import { workbenchClient } from '@workspace/client/workbench';
import { type Plugin, createRuntime } from '@workspace/runtime';

export async function createProduct(
  connected = false,
  options: {
    fetchHost?: typeof fetch;
    prefix?: string;
    workspaceStorageKey?: string;
    plugins?: Plugin[];
  } = {},
) {
  const dataPlugin = connected
    ? (await import('@workspace/client/bootstrap/connected')).createConnectedData(options)
    : (await import('@workspace/client/bootstrap/demo')).demoData;

  return createRuntime([
    workbenchClient,
    createConversationPlugin(connected),
    chatClient,
    filesClient,
    createTrajectoryPlugin(connected),
    dataPlugin,
    ...(options.plugins ?? []),
    ...(connected ? [modelProvidersClient, agentPresetsClient] : []),
  ]);
}
