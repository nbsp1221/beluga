import type { Plugin } from '@workspace/runtime';
import {
  AGENT_PRESETS_PATH,
  CONVERSATION_PATH,
  agentPresetsSchema,
  conversationCatalogSchema,
} from '@workspace/protocol/host';
import { protectedFetch } from '../auth/session.js';
import { createConnectedAgentPresets } from '../features/agent-presets/data/connected.js';
import { createConnectedConversation } from '../features/conversation/data/connected.js';
import { createConnectedModelProviders } from '../features/model-providers/data/connected.js';
import { createConnectedTrajectory } from '../features/trajectory/data/connected.js';
import { createConnectedWorkspaces } from '../features/workspaces/data/connected.js';
import { createHostRequest } from '../transport/host-http.js';

export function createConnectedData({
  fetchHost = protectedFetch,
  prefix,
  workspaceStorageKey,
}: {
  fetchHost?: typeof fetch;
  prefix?: string;
  workspaceStorageKey?: string;
} = {}): Plugin {
  return {
    id: 'connected-data',
    provides: ['conversation', 'workspaces', 'agentPresets', 'modelProviders', 'trajectoryClient'],
    async setup(context) {
      const lifetime = new AbortController();
      context.onDispose(() => lifetime.abort());
      const request = createHostRequest(lifetime.signal, fetchHost);

      const [catalog, presets] = await Promise.all([
        request(CONVERSATION_PATH).then((value) => conversationCatalogSchema.parse(value)),
        request(AGENT_PRESETS_PATH).then((value) => agentPresetsSchema.parse(value)),
      ]);

      const workspaces = createConnectedWorkspaces(request, catalog.workspaces);
      const agentPresets = createConnectedAgentPresets(request, presets);
      const modelProviders = createConnectedModelProviders(request, {
        models: catalog.models,
        defaultModel: catalog.defaultModel,
      });

      context.provide('workspaces', workspaces);
      context.provide('agentPresets', agentPresets);
      context.provide('modelProviders', modelProviders);
      context.provide('trajectoryClient', createConnectedTrajectory(lifetime.signal, fetchHost));
      context.provide(
        'conversation',
        createConnectedConversation({
          signal: lifetime.signal,
          request,
          fetchHost,
          prefix,
          workspaceStorageKey,
          sessions: catalog.sessions,
          workspaces,
          agentPresets,
          modelProviders,
        }),
      );
    },
  };
}
