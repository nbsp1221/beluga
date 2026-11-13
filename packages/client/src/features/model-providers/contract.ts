import '@workspace/runtime';
import type { ConnectProvider, ModelOption, ProviderSettings } from '@workspace/protocol/host';
import type { ReadStore } from '../../state/store.js';

export interface ModelCatalog {
  models: readonly ModelOption[];
  defaultModel: string | null;
}

export interface ModelProvidersClient extends ReadStore<ModelCatalog> {
  getProviderSettings(): Promise<ProviderSettings>;
  connectProvider(connection: ConnectProvider): Promise<ProviderSettings>;
  connectCodex(): Promise<ProviderSettings>;
  disconnectProvider(id: string): Promise<ProviderSettings>;
  setDefaultModel(model: string | null): Promise<ProviderSettings>;
}

declare module '@workspace/runtime' {
  interface Services {
    modelProviders: ModelProvidersClient;
  }
}
