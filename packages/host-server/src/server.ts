import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { createHost } from './app.js';
import { accessCodeHostOptions } from './config.js';

type ServerOptions = {
  port?: string;
  bind?: string;
} & (
  | { statusOnly: true }
  | {
      statusOnly?: false;
      origin?: string;
      dataDir: string;
      webDir: string;
      onListening?: () => Promise<void>;
    }
);

export async function startServer(options: ServerOptions) {
  const port = Number(options.port ?? 8917);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Use a port between 1 and 65535.');
  }
  const host = await createHost(
    options.statusOnly
      ? {}
      : await accessCodeHostOptions(
          options.dataDir,
          options.webDir,
          options.origin || `http://127.0.0.1:${port}`,
        ),
  );

  let server: ReturnType<typeof serve> | undefined;
  try {
    const listener = serve({
      fetch: host.fetch,
      hostname: options.bind || '127.0.0.1',
      port,
    });
    server = listener;
    await once(listener, 'listening');
    const info = listener.address();
    if (!info || typeof info === 'string') {
      throw new Error('Host did not bind');
    }
    if (!options.statusOnly) {
      await options.onListening?.();
    }
    console.log(`Host listening on http://${info.address}:${info.port}`);

    let stopping: Promise<void> | undefined;

    const stop = () => {
      stopping ??= new Promise<void>((resolve, reject) => {
        listener.close((error) => (error ? reject(error) : resolve()));
        if ('closeAllConnections' in listener) {
          listener.closeAllConnections();
        }
      }).then(
        () => host.dispose(),
        async (error: unknown) => {
          await host.dispose();
          throw error;
        },
      );
      void stopping.catch(reportError);
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    server?.close();
    if (server && 'closeAllConnections' in server) {
      server.closeAllConnections();
    }
    await host.dispose();
    throw error;
  }
}

function reportError(error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
