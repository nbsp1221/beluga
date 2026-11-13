import { PROVIDERS_PATH, providerSettingsSchema } from '@workspace/protocol/host';
import type { HostRequest } from '../../../transport/host-http.js';
import type { ModelCatalog, ModelProvidersClient } from '../contract.js';
import { createStore } from '../../../state/store.js';

export function createConnectedModelProviders(
  request: HostRequest,
  initial: ModelCatalog,
): ModelProvidersClient {
  const store = createStore(initial);

  const publishProviderSettings = async (response: Promise<unknown>) => {
    const settings = providerSettingsSchema.parse(await response);
    store.publish({
      models: settings.providers.flatMap((provider) => provider.models),
      defaultModel: settings.defaultModel,
    });
    return settings;
  };

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    getProviderSettings() {
      return publishProviderSettings(request(PROVIDERS_PATH));
    },
    connectProvider(connection) {
      return publishProviderSettings(request(PROVIDERS_PATH, connection));
    },
    connectCodex() {
      return publishProviderSettings(request(`${PROVIDERS_PATH}/openai-codex`, undefined, 'PUT'));
    },
    disconnectProvider(id) {
      return publishProviderSettings(
        request(`${PROVIDERS_PATH}/${encodeURIComponent(id)}`, undefined, 'DELETE'),
      );
    },
    setDefaultModel(model) {
      return publishProviderSettings(request(`${PROVIDERS_PATH}/default-model`, { model }, 'PUT'));
    },
  };
}
