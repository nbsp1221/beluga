import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error(
    'Build the Linux x64 archive on Linux x64 to include matching native dependencies.',
  );
}

const application = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(application, '../..');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const product: unknown = JSON.parse(readFileSync(join(application, 'package.json'), 'utf8'));
const manager: unknown = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'));
if (
  !isRecord(product) ||
  typeof product.name !== 'string' ||
  !isRecord(manager) ||
  typeof manager.packageManager !== 'string'
) {
  throw new Error('Packaging requires valid application and workspace manifests.');
}

const nodeVersion = readFileSync(join(workspace, '.node-version'), 'utf8').trim();
const pnpmVersion = /^pnpm@(\d+\.\d+\.\d+)$/.exec(manager.packageManager)?.[1];
if (!/^\d+\.\d+\.\d+$/.test(nodeVersion) || !pnpmVersion || !process.env.npm_execpath) {
  throw new Error('Packaging requires pinned Node/pnpm versions and must run through pnpm.');
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: workspace, stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed (exit ${result.status ?? 'unknown'}).`);
  }
}

async function response(url: string): Promise<Response> {
  const result = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!result.ok) {
    throw new Error(`Download failed: ${url} (${result.status}).`);
  }

  return result;
}

async function download(
  url: string,
  target: string,
  algorithm: string,
  digest: string,
  encoding: 'hex' | 'base64',
): Promise<void> {
  const bytes = Buffer.from(await (await response(url)).arrayBuffer());
  if (createHash(algorithm).update(bytes).digest(encoding) !== digest) {
    throw new Error(`Integrity check failed: ${url}.`);
  }

  writeFileSync(target, bytes);
}

const output = join(application, 'dist');
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(output, '.package-'));

try {
  const root = join(temporary, 'beluga');
  run('pnpm', ['--filter', product.name, '--prod', 'deploy', join(root, 'app')]);

  const nodeArchive = `node-v${nodeVersion}-linux-x64.tar.xz`;
  const nodeUrl = `https://nodejs.org/dist/v${nodeVersion}`;
  const sums = await (await response(`${nodeUrl}/SHASUMS256.txt`)).text();
  const checksum = sums
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === nodeArchive)?.[0];
  if (!checksum) {
    throw new Error(`Node release has no checksum for ${nodeArchive}.`);
  }

  const nodeDownload = join(temporary, nodeArchive);
  await download(`${nodeUrl}/${nodeArchive}`, nodeDownload, 'sha256', checksum, 'hex');

  const extractedNode = join(temporary, 'node');
  mkdirSync(extractedNode);
  run('tar', ['-xJf', nodeDownload, '--strip-components=1', '-C', extractedNode]);

  const runtime = join(root, 'runtime');
  mkdirSync(join(runtime, 'bin'), { recursive: true });
  copyFileSync(join(extractedNode, 'bin/node'), join(runtime, 'bin/node'));
  copyFileSync(join(extractedNode, 'LICENSE'), join(runtime, 'NODE-LICENSE'));

  const pnpmRelease: unknown = await (
    await response(`https://registry.npmjs.org/@pnpm%2fexe.linux-x64/${pnpmVersion}`)
  ).json();
  if (
    !isRecord(pnpmRelease) ||
    !isRecord(pnpmRelease.dist) ||
    typeof pnpmRelease.dist.tarball !== 'string' ||
    typeof pnpmRelease.dist.integrity !== 'string'
  ) {
    throw new Error('The pnpm registry response must declare a tarball and integrity.');
  }

  const integrity = /^sha512-(.+)$/.exec(pnpmRelease.dist.integrity)?.[1];
  if (!integrity) {
    throw new Error('The pnpm release must declare SHA-512 integrity.');
  }

  const pnpmDownload = join(temporary, 'pnpm.tgz');
  await download(pnpmRelease.dist.tarball, pnpmDownload, 'sha512', integrity, 'base64');

  const extractedPnpm = join(temporary, 'pnpm');
  mkdirSync(extractedPnpm);
  run('tar', ['-xzf', pnpmDownload, '--strip-components=1', '-C', extractedPnpm]);
  copyFileSync(join(extractedPnpm, 'pnpm'), join(runtime, 'bin/pnpm'));
  copyFileSync(join(extractedPnpm, 'LICENSE'), join(runtime, 'PNPM-LICENSE'));
  copyFileSync(
    join(extractedPnpm, 'THIRD-PARTY-NOTICES.md'),
    join(runtime, 'PNPM-THIRD-PARTY-NOTICES.md'),
  );

  mkdirSync(join(root, 'bin'));
  copyFileSync(join(application, 'bin/beluga'), join(root, 'bin/beluga'));
  copyFileSync(join(application, 'packaging/install.sh'), join(root, 'install.sh'));

  mkdirSync(join(root, 'systemd'));
  copyFileSync(
    join(application, 'packaging/beluga@.service'),
    join(root, 'systemd/beluga@.service'),
  );

  for (const entry of ['runtime/bin/node', 'runtime/bin/pnpm', 'bin/beluga', 'install.sh']) {
    chmodSync(join(root, entry), 0o755);
  }

  copyFileSync(join(workspace, 'LICENSE'), join(root, 'LICENSE'));
  copyFileSync(join(application, 'packaging/README.md'), join(root, 'README.md'));

  const filename = 'beluga-linux-x64.tar.gz';
  const archive = join(temporary, filename);
  run('tar', ['-czf', archive, '-C', temporary, 'beluga']);

  const hash = createHash('sha256').update(readFileSync(archive)).digest('hex');
  renameSync(archive, join(output, filename));
  writeFileSync(join(output, `${filename}.sha256`), `${hash}  ${filename}\n`);
  copyFileSync(join(workspace, 'install.sh'), join(output, 'install.sh'));
  console.log(`Created ${join(output, filename)}`);
} finally {
  rmSync(temporary, { recursive: true });
}
