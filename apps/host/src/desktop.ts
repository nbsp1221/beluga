import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { serve } from '@hono/node-server';
import { createDesktopAuth, desktopSessionCookie } from '@workspace/host-plugins/auth/host';
import { createHost } from './app.js';
import { connectedHostOptions } from './config.js';
import { createDesktopConnections } from './desktop-connections.js';

export async function startDesktopHost(dataDir: string, webDir: string) {
  if (process.stdin.isTTY || process.stdout.isTTY) {
    throw new Error('Desktop Host requires an owned control pipe.');
  }
  const control = createInterface({ input: process.stdin });
  const input = control[Symbol.asyncIterator]();
  if ((await input.next()).value !== 'start') {
    throw new Error('Desktop Host did not receive its start command.');
  }
  const shutdown = input.next();
  const token = randomBytes(32).toString('base64url');
  const mutations = new Set<Promise<Response>>();
  let host: Awaited<ReturnType<typeof createHost>> | undefined;
  let connections: ReturnType<typeof createDesktopConnections> | undefined;
  let stopping = false;
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (!host || stopping) {
        return new Response(null, { status: 503 });
      }
      const remote = connections?.handle(request);
      if (remote) {
        return remote;
      }
      const response = host.fetch(request);
      if (request.method === 'GET' || request.method === 'HEAD') {
        return response;
      }
      mutations.add(response);
      return response.finally(() => mutations.delete(response));
    },
  });

  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Desktop Host did not bind to loopback.');
    }
    const origin = `http://127.0.0.1:${address.port}`;
    host = await createHost(
      await connectedHostOptions(dataDir, webDir, origin, createDesktopAuth(origin, token), true),
    );
    connections = createDesktopConnections(origin, host.authenticate);
    await announce({ type: 'ready', origin, cookie: desktopSessionCookie, token });
    await shutdown;
    stopping = true;
    connections.stop();
    await Promise.allSettled(mutations);
    await host.abortConversations();
  } finally {
    stopping = true;
    const closed = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    if ('closeAllConnections' in server) {
      server.closeAllConnections();
    }
    await closed;
    control.close();
    process.stdin.destroy();
    await host?.dispose();
  }
  await announce({ type: 'stopped' });
}

function announce(message: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(message)}\n`, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}
