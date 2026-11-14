import type { Plugin, Runtime } from '@workspace/runtime';
import { DESKTOP_CONNECTIONS_PATH } from '@workspace/protocol/host';
import { Network } from 'lucide-react';
import { ConnectionError, Connections } from './Connections.tsx';
import { createProduct } from './product.ts';

interface Target {
  runtime: Runtime;
  path: string;
  remote?: { address: string; id: string };
}

export async function createDesktopProduct(publish: (target: Target) => void) {
  let current: Target;
  let localRoute = window.location.pathname + window.location.search;

  const connectionPlugin: Plugin = {
    id: 'desktop-connections',
    requires: ['destinations'] as const,
    setup(context) {
      context.onDispose(
        context.get('destinations').registerSetting({
          id: 'connections',
          label: 'Connections',
          icon: Network,
          component: () => (
            <Connections
              remoteAddress={current.remote?.address}
              connect={connect}
              selectLocal={selectLocal}
            />
          ),
        }),
      );
    },
  };
  const local = await createProduct(true, { plugins: [connectionPlugin] });
  current = { runtime: local, path: localRoute };

  async function replace(target: Target) {
    const previous = current;
    current = target;
    publish(target);
    if (previous.remote) {
      await disposeRemote(previous.runtime, previous.remote.id);
    }
  }

  async function connect(address: string, code: string, signal: AbortSignal) {
    const response = await fetch(DESKTOP_CONNECTIONS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, code }),
      signal,
    });
    if (!response.ok) {
      const result: unknown = await response.json().catch(() => undefined);
      const message =
        result &&
        typeof result === 'object' &&
        'error' in result &&
        typeof result.error === 'string'
          ? result.error
          : 'Could not connect to the server.';
      throw new ConnectionError(message, response.status === 401);
    }
    const result: unknown = await response.json().catch(() => undefined);
    if (
      !result ||
      typeof result !== 'object' ||
      !('address' in result) ||
      typeof result.address !== 'string' ||
      !('id' in result) ||
      typeof result.id !== 'string'
    ) {
      throw new ConnectionError('The desktop Host returned an invalid connection.');
    }
    const remote = { address: result.address, id: result.id };
    const prefix = DESKTOP_CONNECTIONS_PATH + '/' + remote.id;
    let staging = true;
    let runtime: Runtime | undefined;
    try {
      runtime = await createProduct(true, {
        prefix,
        workspaceStorageKey: 'beluga:last-workspace:' + remote.address,
        plugins: [connectionPlugin],
        async fetchHost(input, init) {
          const request = new Request(
            typeof input === 'string' ? new URL(input, window.location.origin) : input,
            init,
          );
          const url = new URL(request.url);
          if (url.origin !== window.location.origin) {
            throw new Error('The API request belongs to another Host.');
          }
          if (!url.pathname.startsWith(prefix + '/api/')) {
            if (!url.pathname.startsWith('/api/')) {
              throw new Error('Invalid Host API request.');
            }
            url.pathname = prefix + url.pathname;
          }
          return fetch(url, {
            ...init,
            method: request.method,
            headers: request.headers,
            body: init?.body ?? (request.body ? await request.arrayBuffer() : undefined),
            signal: staging
              ? AbortSignal.any([request.signal, signal, AbortSignal.timeout(10_000)])
              : request.signal,
          });
        },
      });
      signal.throwIfAborted();
      staging = false;
    } catch {
      await disposeRemote(runtime, remote.id);
      throw new ConnectionError(
        'Could not load the remote workspace. Check the server and try again.',
      );
    }
    await replace({ runtime, remote, path: '/chat' });
  }

  function selectLocal() {
    return replace({ runtime: local, path: localRoute });
  }

  return {
    initial: current,
    trackLocalRoute: (path: string) => {
      localRoute = path;
    },
    async dispose() {
      if (current.remote) {
        await disposeRemote(current.runtime, current.remote.id);
      }
      await local.dispose();
    },
  };
}

async function disposeRemote(runtime: Runtime | undefined, id: string) {
  const results = await Promise.allSettled([
    runtime?.dispose(),
    fetch(DESKTOP_CONNECTIONS_PATH + '/' + id, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10_000),
    }).then((response) => {
      if (!response.ok) {
        throw new Error('Could not release remote connection.');
      }
    }),
  ]);
  if (results.some(({ status }) => status === 'rejected')) {
    console.warn('Could not finish cleaning up the previous desktop connection.');
  }
}
