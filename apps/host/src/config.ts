import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createAccessCodeAuth, readAccessCodeVerifier } from '@workspace/host-plugins/auth/host';
import { openModelProviders } from '@workspace/host-plugins/model-providers';
import { workspaceCatalogPath } from '@workspace/host-plugins/workspace/host';
import type { HostOptions } from './product.js';
import { createWeb } from './web.js';

export function launchOptions(args: readonly string[], env: NodeJS.ProcessEnv) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'port': { type: 'string' },
      'bind': { type: 'string' },
      'origin': { type: 'string' },
      'data-dir': { type: 'string' },
      'web-dir': { type: 'string' },
      'help': { type: 'boolean', short: 'h' },
    },
  });

  const port = Number(values.port ?? env.PORT ?? 8917);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Use a port between 1 and 65535.');
  }

  const dataHome = defaultDataHome(env);
  const dataDir = resolve(values['data-dir'] ?? join(dataHome, 'beluga'));

  return {
    command: positionals.join(' ') || 'serve',
    port,
    bind: values.bind ?? '127.0.0.1',
    origin: values.origin ?? (env.BELUGA_ORIGIN || `http://127.0.0.1:${port}`),
    dataDir,
    databasePath: join(dataDir, 'chat.sqlite'),
    credentialPath: join(dataDir, 'access-code.json'),
    webDir: resolve(values['web-dir'] ?? resolve(import.meta.dirname, '../../web/dist')),
    notifySystemd: process.platform === 'linux' && Boolean(env.NOTIFY_SOCKET),
    help: values.help,
  };
}

function defaultDataHome(env: NodeJS.ProcessEnv) {
  if (process.platform === 'win32') {
    return env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  }

  const configuredDataHome = env.XDG_DATA_HOME;
  if (configuredDataHome && isAbsolute(configuredDataHome)) {
    return configuredDataHome;
  }

  return join(homedir(), '.local', 'share');
}

export async function hostOptions(options: ReturnType<typeof launchOptions>): Promise<HostOptions> {
  if (options.command === 'status') {
    return {};
  }

  const loadVerifier = () => readAccessCodeVerifier(options.credentialPath);

  await loadVerifier().catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error('Initialize Beluga access with auth init in the same data directory.');
    }
    throw error;
  });
  return connectedHostOptions(
    options.dataDir,
    options.webDir,
    options.origin,
    createAccessCodeAuth({
      origin: options.origin,
      databasePath: join(options.dataDir, 'auth.sqlite'),
      loadVerifier,
    }),
  );
}

export async function connectedHostOptions(
  dataDir: string,
  webDir: string,
  origin: string,
  auth: NonNullable<HostOptions['auth']>,
  desktop = false,
): Promise<HostOptions> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const databasePath = join(dataDir, 'chat.sqlite');
  return {
    auth,
    harness: {
      origin,
      openProviders: openModelProviders(workspaceCatalogPath(databasePath), dataDir),
      databasePath,
    },
    web: await createWeb(webDir, desktop),
  };
}
