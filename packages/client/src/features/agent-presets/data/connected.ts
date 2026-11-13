import {
  AGENT_PRESETS_PATH,
  type AgentPresets,
  agentPresetSchema,
  agentPresetsSchema,
} from '@workspace/protocol/host';
import type { HostRequest } from '../../../transport/host-http.js';
import type { AgentPresetsClient } from '../contract.js';
import { createStore } from '../../../state/store.js';

export function createConnectedAgentPresets(
  request: HostRequest,
  initial: AgentPresets,
): AgentPresetsClient {
  const store = createStore(initial);
  let presetRefreshGeneration = 0;

  const refresh = async () => {
    const version = ++presetRefreshGeneration;
    const agentPresets = agentPresetsSchema.parse(await request(AGENT_PRESETS_PATH));
    if (version === presetRefreshGeneration) {
      store.publish(agentPresets);
    }
  };

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    refresh,
    async save(definition, previous) {
      const saved = agentPresetSchema.parse(
        await (previous
          ? request(
              `${AGENT_PRESETS_PATH}/${encodeURIComponent(previous.id)}`,
              { ...definition, version: previous.version },
              'PUT',
            )
          : request(AGENT_PRESETS_PATH, definition)),
      );
      // Ignore any catalog refresh started before the mutation returned.
      presetRefreshGeneration++;
      const previousList = store.getSnapshot();
      store.publish({
        ...previousList,
        presets: previous
          ? previousList.presets.map((preset) => (preset.id === saved.id ? saved : preset))
          : [...previousList.presets, saved],
      });
      return saved;
    },
  };
}
