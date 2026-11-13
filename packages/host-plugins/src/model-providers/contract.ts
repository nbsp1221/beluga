import type { Provider } from '@earendil-works/pi-ai';
import type { ConnectProvider, ProviderConnection } from '@workspace/protocol/host';

export interface ModelProviders {
  contextWindow(providerId: string, modelId: string): number | undefined;
  list(): Promise<ProviderConnection[]>;
  connect(input: ConnectProvider): Promise<void>;
  setCodexConnected(connected: boolean): void | Promise<void>;
  disconnect(id: string): Promise<boolean>;
  close(): void;
}

export type OpenModelProviders = (register: (provider: Provider) => void) => ModelProviders;

export class ProviderConnectionError extends Error {}
