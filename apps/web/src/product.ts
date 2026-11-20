import type { Plugin } from '@workspace/runtime';
import { createClientProduct } from '@workspace/client/bootstrap/product';

export async function createProduct(
  connected = false,
  options: {
    fetchHost?: typeof fetch;
    prefix?: string;
    workspaceStorageKey?: string;
    plugins?: Plugin[];
  } = {},
) {
  if (!connected) {
    const { demoData } = await import('@workspace/client/bootstrap/demo');

    return createClientProduct({ connected, data: demoData, plugins: options.plugins });
  }

  const [{ createConnectedData }, { modelProvidersClient }, { agentPresetsClient }] =
    await Promise.all([
      import('@workspace/client/bootstrap/connected'),
      import('@workspace/client/model-providers'),
      import('@workspace/client/agent-presets'),
    ]);

  return createClientProduct({
    connected,
    data: createConnectedData(options),
    plugins: [...(options.plugins ?? []), modelProvidersClient, agentPresetsClient],
  });
}
