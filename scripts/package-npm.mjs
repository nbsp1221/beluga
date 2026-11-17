import { execFileSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] ?? 'dist/npm');
const scratch = await mkdtemp(join(tmpdir(), 'beluga-npm-'));
const stage = join(scratch, 'package');
const modules = join(stage, 'node_modules');

const read = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function writeManifest(path, value) {
  // The deployed package may share a hard link with the workspace.
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' });
const installedVersion = async (name) => (await read(join(modules, name, 'package.json'))).version;

try {
  run('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@retn0/beluga', '--filter=web']);
  run('pnpm', [
    '--filter',
    '@retn0/beluga',
    '--config.node-linker=hoisted',
    '--config.inject-workspace-packages=true',
    'deploy',
    '--prod',
    stage,
  ]);

  const manifest = await read(join(root, 'apps/cli/package.json'));
  const { version } = manifest;
  delete manifest.private;
  delete manifest.scripts;
  delete manifest.devDependencies;
  const dependencies = {};
  for (const name of Object.keys(manifest.dependencies)) {
    dependencies[name] = await installedVersion(name);
  }

  // pnpm deploy leaves workspace and catalog specs in copied private manifests.
  for (const name of await readdir(join(modules, '@workspace'))) {
    const path = join(modules, '@workspace', name, 'package.json');
    const dependency = await read(path);
    delete dependency.devDependencies;
    delete dependency.scripts;
    for (const [key, spec] of Object.entries(dependency.dependencies ?? {})) {
      if (spec.startsWith('workspace:') || spec.startsWith('catalog:')) {
        dependency.dependencies[key] = await installedVersion(key);
      }
    }
    await writeManifest(path, dependency);
  }

  await writeManifest(join(stage, 'package.json'), {
    ...manifest,
    dependencies,
    bundleDependencies: true,
    os: ['linux'],
    cpu: ['x64'],
  });
  await cp(join(root, 'apps/web/dist'), join(stage, 'dist/web'), { recursive: true });
  await chmod(join(stage, manifest.bin.beluga), 0o755);
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md']) {
    await copyFile(join(root, file), join(stage, file));
  }
  await copyFile(
    join(root, 'packages/client/node_modules/@flue/sdk/LICENSE'),
    join(stage, 'FLUE-SDK-LICENSE.txt'),
  );

  await mkdir(output, { recursive: true });
  console.log(`Packing ${manifest.name}@${version}`);
  execFileSync('pnpm', ['--config.node-linker=hoisted', 'pack', '--pack-destination', output], {
    cwd: stage,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const tarball = join(
    output,
    `${manifest.name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`,
  );
  const prefix = join(scratch, 'smoke');
  console.log('Verifying the published layout with an offline npm install.');
  run('npm', [
    'install',
    '--global',
    '--omit=dev',
    '--offline',
    '--ignore-scripts',
    '--prefix',
    prefix,
    tarball,
  ]);
  run(join(prefix, 'bin/beluga'), ['--help'], scratch);
  const packagedVersion = execFileSync(join(prefix, 'bin/beluga'), ['--version'], {
    encoding: 'utf8',
  });
  if (packagedVersion.trim() !== version) {
    throw new Error('Installed CLI version does not match the release.');
  }
  const installedModules = execFileSync('npm', ['root', '--global', '--prefix', prefix], {
    encoding: 'utf8',
  }).trim();
  run(process.execPath, [
    join(root, 'scripts/check-packaged-tools.mjs'),
    join(installedModules, manifest.name),
  ]);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
