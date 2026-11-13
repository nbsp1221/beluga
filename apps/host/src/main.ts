import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { issueAccessCode } from '@workspace/host-plugins/auth/host';
import { createHost } from './app.js';
import { hostOptions, launchOptions } from './config.js';
import { startDesktopHost } from './desktop.js';

const usage = `Beluga Host
  serve [--bind ADDRESS] [--port PORT] [--origin ORIGIN] [--data-dir DIR] [--web-dir DIR]
  auth init|rotate [--data-dir DIR]`;

async function start() {
  const options = launchOptions(process.argv.slice(2), process.env);

  if (options.help) {
    console.log(usage);
    return;
  }

  if (options.command === 'desktop') {
    await startDesktopHost(options.dataDir, options.webDir);
    return;
  }

  if (options.command === 'auth init' || options.command === 'auth rotate') {
    await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
    const code = await issueAccessCode(options.credentialPath, options.command === 'auth rotate');
    console.log(`Beluga access code: ${code}`);
    return;
  }

  if (options.command !== 'serve' && options.command !== 'status') {
    throw new Error(usage);
  }

  const host = await createHost(await hostOptions(options));

  try {
    const server = serve({
      fetch: host.fetch,
      hostname: options.bind,
      port: options.port,
    });
    await once(server, 'listening');
    const info = server.address();
    if (!info || typeof info === 'string') {
      throw new Error('Host did not bind');
    }
    console.log(`Host listening on http://${info.address}:${info.port}`);

    let stopping: Promise<void> | undefined;

    const stop = () => {
      stopping ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        if ('closeAllConnections' in server) {
          server.closeAllConnections();
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
    await host.dispose();
    throw error;
  }
}

function reportError(error: unknown) {
  console.error(error);
  process.exitCode = 1;
}

void start().catch(reportError);
