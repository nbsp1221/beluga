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
  const dataPlugin = connected
    ? (await import('@workspace/client/bootstrap/connected')).createConnectedData(options)
    : (await import('@workspace/client/bootstrap/demo')).demoData;

  return createClientProduct({ connected, data: dataPlugin, plugins: options.plugins });
}
