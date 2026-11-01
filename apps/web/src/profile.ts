import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readProfileManifest, writeProfileBundles } from '@deepseek-ai/dsh-app-boot';

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function runPluginCommand(cli: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, [cli, 'plugin', '--profile', 'web', ...args], {
    env,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`DSH profile preparation failed (exit ${result.status ?? 'unknown'}).`);
  }
}

export function prepareProfile(
  cli: string,
  home: string,
  application: string,
  env: NodeJS.ProcessEnv,
): void {
  const profile = join(home, 'profiles', 'web');
  const manifest = existsSync(join(profile, 'package.json'))
    ? readProfileManifest('beluga', profile)
    : {};

  const dependencies = manifest.dependencies ?? {};
  if (typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    throw new Error('Invalid DSH profile dependencies.');
  }

  const product = readProfileManifest('beluga', application);
  const plugins = Object.keys(product.dependencies ?? {}).flatMap((name) => {
    const path = join(application, 'node_modules', name);
    // Unlike an inventory read, a required dependency must not silently disappear.
    const installed = readProfileManifest('beluga', path);
    return installed.dsh?.bundle?.patch === undefined ? [] : [{ name, path }];
  });
  const names = new Set(plugins.map((plugin) => plugin.name));

  const bundles = manifest.dsh?.profile?.bundles ?? [];
  const disabled = new Set(
    plugins
      .filter(
        (plugin) => Object.hasOwn(dependencies, plugin.name) && !bundles.includes(plugin.name),
      )
      .map((plugin) => plugin.name),
  );

  // Only links into this application's packages are owned by the product.
  const removals = Object.entries(dependencies)
    .filter(
      ([name, spec]) =>
        !names.has(name) &&
        typeof spec === 'string' &&
        spec.startsWith('link:') &&
        resolve(profile, spec.slice(5)) === resolve(application, 'node_modules', name),
    )
    .map(([name]) => name);

  const updates = [];
  for (const plugin of plugins) {
    try {
      const spec = dependencies[plugin.name];
      if (
        typeof spec !== 'string' ||
        !spec.startsWith('link:') ||
        resolve(profile, spec.slice(5)) !== resolve(plugin.path) ||
        realpathSync(join(profile, 'node_modules', plugin.name)) !== realpathSync(plugin.path)
      ) {
        updates.push(`link:${plugin.path}`);
      }
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
      updates.push(`link:${plugin.path}`);
    }
  }

  if (removals.length > 0) {
    runPluginCommand(cli, ['remove', ...removals], env);
  }
  if (updates.length > 0) {
    runPluginCommand(cli, ['add', ...updates], env);
  }

  if (disabled.size > 0 && (removals.length > 0 || updates.length > 0)) {
    // `plugin add` enables bundles; repairs must retain the user's disabled choices.
    const current = readProfileManifest('beluga', profile);
    const enabled = current.dsh?.profile?.bundles ?? [];
    const preserved = enabled.filter((name) => !disabled.has(name));
    if (preserved.length !== enabled.length) {
      writeProfileBundles(profile, current, preserved);
    }
  }
}
