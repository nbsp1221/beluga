import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const runtime = join(desktop, 'dist', 'runtime');
const host = join(runtime, 'host');
const web = join(runtime, 'web');
const binaries = join(desktop, 'dist', 'binaries');
const node = join(binaries, 'beluga-node-x86_64-pc-windows-msvc.exe');
const distribution = 'https://nodejs.org/dist/v24.22.2';
const checksum = '1c331340fa6cac5e4294725959070a143fa0507195a78ad77eed7943f719aac9';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The first Beluga desktop installer targets Windows x64.');
}
const pnpm = process.env.npm_execpath;
if (!pnpm) {
  throw new Error('Run Windows packaging with pnpm.');
}

function run(cwd, ...args) {
  const native = extname(pnpm).toLowerCase() === '.exe';
  const command = native ? pnpm : process.execPath;
  const commandArgs = native ? args : [pnpm, ...args];
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    throw result.error ?? new Error(`pnpm ${args[0]} failed (${result.status}).`);
  }
}

async function download(url) {
  const response = await globalThis.fetch(url);
  if (!response.ok) {
    throw new Error(`Node distribution download failed (${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

await mkdir(binaries, { recursive: true });
const current = await readFile(node).catch(() => undefined);
if (!current || sha256(current) !== checksum) {
  const binary = await download(`${distribution}/win-x64/node.exe`);
  if (sha256(binary) !== checksum) {
    throw new Error('Bundled Node checksum does not match.');
  }
  await writeFile(node, binary);
}
await mkdir(runtime, { recursive: true });
await cp(join(root, 'LICENSE'), join(runtime, 'LICENSE'));
await cp(join(root, 'THIRD_PARTY_NOTICES.md'), join(runtime, 'THIRD_PARTY_NOTICES.md'));
await cp(
  join(root, 'packages/client/node_modules/@flue/sdk/LICENSE'),
  join(runtime, 'FLUE-SDK-LICENSE.txt'),
);
const license = join(runtime, 'NODE-LICENSE.txt');
try {
  await readFile(license);
} catch {
  await writeFile(
    license,
    await download('https://raw.githubusercontent.com/nodejs/node/v24.22.2/LICENSE'),
  );
}

run(root, 'exec', 'turbo', 'run', 'build', '--filter=web', '--filter=@workspace/host');

// These two directories contain only generated build inputs.
if ((await realpath(runtime)).toLowerCase() !== runtime.toLowerCase()) {
  throw new Error('The desktop runtime directory must be local to the desktop package.');
}
for (const target of [host, web]) {
  const info = await lstat(target).catch((error) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
  if (info?.isSymbolicLink()) {
    throw new Error('The desktop runtime must not contain junctions.');
  }
  await rm(target, { recursive: true, force: true });
}
// Apply deployment settings outside the checkout so the root lock and install state stay intact.
const deployment = await mkdtemp(join(tmpdir(), 'beluga-desktop-deploy-'));
try {
  for (const file of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    await cp(join(root, file), join(deployment, file));
  }
  const hostBuilds = new Set(['host', 'host-plugins', 'protocol', 'runtime']);
  for (const parent of ['apps', 'packages']) {
    for (const { name } of (await readdir(join(root, parent), { withFileTypes: true })).filter(
      (entry) => entry.isDirectory(),
    )) {
      const directory = join(parent, name);
      const destination = join(deployment, directory);
      await mkdir(destination, { recursive: true });
      await cp(join(root, directory, 'package.json'), join(destination, 'package.json'));
      if (hostBuilds.has(name)) {
        await cp(join(root, directory, 'dist'), join(destination, 'dist'), { recursive: true });
      }
    }
  }
  run(
    deployment,
    '--filter',
    '@workspace/host',
    '--config.node-linker=hoisted',
    '--config.inject-workspace-packages=true',
    'deploy',
    '--prod',
    host,
  );
} finally {
  await rm(deployment, { recursive: true, force: true });
}
await cp(join(root, 'apps/web/dist'), web, { recursive: true });
await readFile(join(host, 'dist/main.js'));

for (const entry of await readdir(host, { recursive: true, withFileTypes: true })) {
  if (entry.isSymbolicLink()) {
    throw new Error('Desktop Host deployment must not contain links.');
  }
}
