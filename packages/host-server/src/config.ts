import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import {
  createAccessCodeAuth,
  issueAccessCode,
  readAccessCodeVerifier,
} from '@workspace/host-plugins/auth/host';
import { openModelProviders } from '@workspace/host-plugins/model-providers';
import { workspaceCatalogPath } from '@workspace/host-plugins/workspace/host';
import type { HostOptions } from './product.js';
import { createWeb } from './web.js';

export function resolveDataDir(path?: string) {
  return resolve(path ?? join(defaultDataHome(process.env), 'beluga'));
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

export async function initializeAccessCode(dataDir: string, rotate: boolean) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  return issueAccessCode(join(dataDir, 'access-code.json'), rotate);
}

export async function accessCodeHostOptions(dataDir: string, webDir: string, origin: string) {
  const loadVerifier = () => readAccessCodeVerifier(join(dataDir, 'access-code.json'));

  await loadVerifier().catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error('Initialize Beluga access with auth init in the same data directory.');
    }
    throw error;
  });
  return connectedHostOptions(
    dataDir,
    webDir,
    origin,
    createAccessCodeAuth({ origin, databasePath: join(dataDir, 'auth.sqlite'), loadVerifier }),
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
      instructionsDirectory: dataDir,
    },
    web: await createWeb(webDir, desktop),
  };
}
