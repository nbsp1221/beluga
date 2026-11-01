import { spawn, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProfileManifest, writeProfileBundles } from '@deepseek-ai/dsh-app-boot';
import { test as baseTest, expect } from 'vitest';
import { prepareProfile } from './profile.ts';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = realpathSync(tmpdir());
const lockfile = resolve(appRoot, '../../pnpm-lock.yaml');
const require = createRequire(import.meta.url);
const cli = require.resolve('@deepseek-ai/dsh/lib/bin.js');

const test = baseTest.extend<{
  profile: { home: string; application: string; env: NodeJS.ProcessEnv };
}>({
  profile: async ({ task }, use) => {
    const temporary = realpathSync(mkdtempSync(join(testRoot, 'beluga-test-')));
    const target = relative(testRoot, temporary);
    if (!target.startsWith('beluga-test-') || target.includes('..') || isAbsolute(target)) {
      throw new Error(`Unsafe test directory for ${task.name}.`);
    }

    const home = join(temporary, 'home');
    const application = join(temporary, 'application');
    const originalLockfile = readFileSync(lockfile, 'utf8');
    const env = {
      ...process.env,
      DSH_HOME: home,
      CODEX_HOME: join(temporary, 'codex'),
      DSH_AGENTS_HOME: join(temporary, 'agents'),
      DSH_TELEMETRY_DISABLED: '1',
      PNPM_CONFIG_OFFLINE: 'true',
    };

    try {
      createBundle(join(application, 'node_modules', '@fixture/base'), '@fixture/base');
      writePackage(application, {
        name: 'fixture-application',
        private: true,
        dependencies: { '@fixture/base': '1.0.0' },
      });

      await use({ home, application, env });
    } finally {
      rmSync(temporary, { recursive: true });
      expect(readFileSync(lockfile, 'utf8')).toBe(originalLockfile);
    }
  },
});

function writePackage(directory: string, manifest: Record<string, unknown>): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest, null, 2));
}

function createBundle(directory: string, name: string): void {
  writePackage(directory, {
    name,
    version: '1.0.0',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  });
  writeFileSync(join(directory, 'cordis.patch.yml'), '[]\n');
}

test('a new profile exposes Codex models, remote controls, and worktree management', async ({
  profile: { home, env },
}) => {
  prepareProfile(cli, home, appRoot, env);

  const child = spawn(process.execPath, [cli, 'web', '--no-open', '--port', '0'], {
    cwd: home,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });

  let output = '';
  let failure: Error | undefined;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr.resume();
  child.on('error', (error) => {
    failure = error;
  });
  const closed = new Promise<void>((resolveClose) => {
    child.once('close', () => resolveClose());
  });

  try {
    await expect
      .poll(
        () => {
          if (failure) {
            throw failure;
          }
          if (child.exitCode !== null) {
            throw new Error(`DSH exited before startup: ${child.exitCode}`);
          }
          return /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/.exec(output)?.[1];
        },
        { timeout: 45_000 },
      )
      .toBeDefined();

    const url = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/.exec(output)?.[1];
    if (!url) {
      throw new Error('DSH did not report an authenticated URL.');
    }

    const auth = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    expect(auth.status).toBe(303);

    const cookie = auth.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) {
      throw new Error('DSH did not set an authentication cookie.');
    }

    const rpc = async (method: string, args: Record<string, unknown> = {}): Promise<unknown> => {
      const response = await fetch(new URL(`/api/${method}`, url), {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'test',
          method,
          payload: { args },
        }),
      });

      expect(response.status).toBe(200);
      return response.json();
    };

    const body = await rpc('session/modelCatalog');
    const model: unknown = expect.objectContaining({ id: 'gpt-6-luna' });
    const models: unknown = expect.arrayContaining([model]);
    const group: unknown = expect.objectContaining({ id: 'openai-codex', models });
    const groups: unknown = expect.arrayContaining([group]);
    expect(body).toMatchObject({
      result: {
        ok: true,
        value: { groups },
      },
    });

    const remote = await fetch(new URL('/dsh-reverse-proxy/status', url), {
      headers: { 'x-dsh-reverse-proxy-control': '1' },
      signal: AbortSignal.timeout(10_000),
    });
    expect(remote.status).toBe(200);
    expect(await remote.json()).toMatchObject({ enabled: false, running: false });

    expect(
      await rpc('worktreeManager/getToolSettings', { input: { scope: { kind: 'general' } } }),
    ).toMatchObject({
      result: { ok: true, value: { ok: true, value: { enabled: false } } },
    });
  } finally {
    child.kill();
    await closed;
  }
}, 65_000);

test('discovers new direct bundles without activating libraries or development dependencies', ({
  profile: { home, application, env },
}) => {
  prepareProfile(cli, home, application, env);
  const manifest = join(home, 'profiles', 'web', 'package.json');

  const session = join(home, 'sessions', 'existing.json');
  mkdirSync(dirname(session), { recursive: true });
  writeFileSync(session, 'existing conversation');

  createBundle(join(application, 'node_modules', '@fixture/added'), '@fixture/added');
  createBundle(join(application, 'node_modules', '@fixture/development'), '@fixture/development');
  createBundle(join(application, 'node_modules', '@fixture/transitive'), '@fixture/transitive');
  writePackage(join(application, 'node_modules', '@fixture/library'), {
    name: '@fixture/library',
    version: '1.0.0',
  });
  writePackage(application, {
    name: 'fixture-application',
    dependencies: {
      '@fixture/base': '1.0.0',
      '@fixture/added': '1.0.0',
      '@fixture/library': '1.0.0',
    },
    devDependencies: { '@fixture/development': '1.0.0' },
  });

  prepareProfile(cli, home, application, env);

  const installed = readProfileManifest('test', dirname(manifest));
  expect(Object.keys(installed.dependencies ?? {}).sort()).toEqual([
    '@fixture/added',
    '@fixture/base',
  ]);
  expect(installed.dsh?.profile?.bundles).toContain('@fixture/added');
  expect(readFileSync(session, 'utf8')).toBe('existing conversation');

  const before = readFileSync(manifest, 'utf8');
  prepareProfile(cli, home, application, env);

  expect(readFileSync(manifest, 'utf8')).toBe(before);
}, 60_000);

test('removes retired product links while preserving user plugins, order, and disabled selections', ({
  profile: { home, application, env },
}) => {
  createBundle(join(application, 'node_modules', '@fixture/disabled'), '@fixture/disabled');
  writePackage(application, {
    dependencies: { '@fixture/base': '1.0.0', '@fixture/disabled': '1.0.0' },
  });
  prepareProfile(cli, home, application, env);

  const profile = join(home, 'profiles', 'web');
  const userPlugin = join(dirname(application), 'user-plugin');
  createBundle(userPlugin, '@fixture/user');
  const result = spawnSync(
    process.execPath,
    [cli, 'plugin', '--profile', 'web', 'add', `link:${userPlugin}`],
    { cwd: home, env, encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);

  const installed = readProfileManifest('test', profile);
  const selected = (installed.dsh?.profile?.bundles ?? []).filter(
    (name) => name !== '@fixture/disabled',
  );
  writeProfileBundles(profile, installed, selected);

  const patch = join(profile, 'cordis.patch.yml');
  const userPatch = '# User configuration\n[]\n';
  writeFileSync(patch, userPatch);

  const conversation = join(home, 'sessions', 'existing.json');
  mkdirSync(dirname(conversation), { recursive: true });
  writeFileSync(conversation, 'existing conversation');

  renameSync(
    join(application, 'node_modules', '@fixture/base'),
    join(dirname(application), 'retired-package'),
  );
  renameSync(join(profile, 'node_modules', '@fixture/disabled'), join(profile, 'displaced'));
  createBundle(join(application, 'node_modules', '@fixture/new'), '@fixture/new');
  writePackage(application, {
    dependencies: { '@fixture/disabled': '1.0.0', '@fixture/new': '1.0.0' },
  });

  prepareProfile(cli, home, application, env);

  const updated = readProfileManifest('test', profile);
  expect(Object.keys(updated.dependencies ?? {}).sort()).toEqual([
    '@fixture/disabled',
    '@fixture/new',
    '@fixture/user',
  ]);
  expect(updated.dsh?.profile?.bundles).toEqual([
    ...selected.filter((name) => name !== '@fixture/base'),
    '@fixture/new',
  ]);
  expect(realpathSync(join(profile, 'node_modules', '@fixture/user'))).toBe(
    realpathSync(userPlugin),
  );
  expect(realpathSync(join(profile, 'node_modules', '@fixture/disabled'))).toBe(
    realpathSync(join(application, 'node_modules', '@fixture/disabled')),
  );
  expect(readFileSync(patch, 'utf8')).toBe(userPatch);
  expect(readFileSync(conversation, 'utf8')).toBe('existing conversation');
}, 60_000);

test.for(['missing', 'invalid'] as const)(
  'rejects a %s product package before changing the profile',
  (state, { profile: { home, application, env } }) => {
    prepareProfile(cli, home, application, env);
    const profile = join(home, 'profiles', 'web', 'package.json');
    const before = readFileSync(profile, 'utf8');

    const packageDirectory = join(application, 'node_modules', '@fixture/base');
    if (state === 'missing') {
      renameSync(packageDirectory, join(dirname(application), 'displaced'));
    } else {
      writeFileSync(join(packageDirectory, 'package.json'), '{invalid');
    }

    expect(() => prepareProfile(cli, home, application, env)).toThrow();
    expect(readFileSync(profile, 'utf8')).toBe(before);
  },
);

test('inspecting the configuration does not replace an existing plugin', ({
  profile: { home, application, env },
}) => {
  prepareProfile(cli, home, application, env);
  const manifest = join(home, 'profiles', 'web', 'package.json');
  const before = readFileSync(manifest, 'utf8');

  const result = spawnSync(process.execPath, [join(appRoot, 'src', 'main.ts'), '--dump-config'], {
    cwd: home,
    env,
    encoding: 'utf8',
  });

  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(manifest, 'utf8')).toBe(before);
});

test('refuses to overwrite a damaged profile', ({ profile: { home, application, env } }) => {
  const directory = join(home, 'profiles', 'web');
  mkdirSync(directory, { recursive: true });
  const manifest = join(directory, 'package.json');
  writeFileSync(manifest, '{invalid');

  expect(() => prepareProfile(cli, home, application, env)).toThrow();
  expect(readFileSync(manifest, 'utf8')).toBe('{invalid');
});

test('repairs a missing profile link', ({ profile: { home, application, env } }) => {
  prepareProfile(cli, home, application, env);
  const directory = join(home, 'profiles', 'web');
  renameSync(join(directory, 'node_modules', '@fixture/base'), join(directory, 'displaced'));

  prepareProfile(cli, home, application, env);

  expect(realpathSync(join(directory, 'node_modules', '@fixture/base'))).toBe(
    realpathSync(join(application, 'node_modules', '@fixture/base')),
  );
}, 60_000);
