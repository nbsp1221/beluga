import { PROVIDERS_PATH, providerSettingsSchema } from '@workspace/protocol/host';
import type { HostRequest } from '../../../transport/host-http.js';
import type { ModelCatalog, ModelProvidersClient } from '../contract.js';
import { createStore } from '../../../state/store.js';

export function createConnectedModelProviders(
  request: HostRequest,
  initial: ModelCatalog,
): ModelProvidersClient {
  const store = createStore(initial);
  let readGeneration = 0;

  const publish = (settings: ReturnType<typeof providerSettingsSchema.parse>) => {
    store.publish({
      models: settings.providers.flatMap((provider) => provider.models),
      defaultModel: settings.defaultModel,
      settings,
    });
  };

  const apply = async (response: Promise<unknown>) => {
    const settings = providerSettingsSchema.parse(await response);
    // Reads started before this write completed no longer own the catalog.
    readGeneration += 1;
    publish(settings);
    return settings;
  };

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    async refresh() {
      const generation = ++readGeneration;
      try {
        const settings = providerSettingsSchema.parse(await request(PROVIDERS_PATH));
        if (generation === readGeneration) {
          publish(settings);
        }
      } catch (error) {
        if (generation === readGeneration) {
          throw error;
        }
      }
    },
    connectProvider(connection) {
      return apply(request(PROVIDERS_PATH, connection));
    },
    connectCodex() {
      return apply(request(`${PROVIDERS_PATH}/openai-codex`, undefined, 'PUT'));
    },
    disconnectProvider(id) {
      return apply(request(`${PROVIDERS_PATH}/${encodeURIComponent(id)}`, undefined, 'DELETE'));
    },
    setDefaultModel(model) {
      return apply(request(`${PROVIDERS_PATH}/default-model`, { model }, 'PUT'));
    },
  };
}
