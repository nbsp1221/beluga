import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const tauri = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const runtime = join(tauri, 'dist', 'runtime');
const release = join(tauri, 'target', 'release');
const output = join(release, 'bundle', 'windows-x64');
const installer = join(release, 'bundle', 'nsis', `Beluga_${version}_x64-setup.exe`);
const archiveName = 'beluga-windows-x64-portable.zip';
await access(installer);
const staging = await mkdtemp(join(tmpdir(), 'beluga-portable-'));
const bundle = join(staging, 'Beluga');

try {
  await cp(runtime, bundle, { recursive: true });
  await cp(join(release, 'beluga-desktop.exe'), join(bundle, 'Beluga.exe'));
  await cp(
    join(tauri, 'dist', 'binaries', 'beluga-node-x86_64-pc-windows-msvc.exe'),
    join(bundle, 'beluga-node.exe'),
  );

  const archive = join(staging, archiveName);
  execFileSync('tar.exe', ['-a', '-cf', archive, '-C', staging, 'Beluga'], { stdio: 'inherit' });

  const unpacked = join(staging, 'unpacked');
  await mkdir(unpacked);
  execFileSync('tar.exe', ['-xf', archive, '-C', unpacked], { stdio: 'inherit' });
  const app = join(unpacked, 'Beluga');
  for (const file of [
    'Beluga.exe',
    'web/index.html',
    'LICENSE',
    'NODE-LICENSE.txt',
    'FLUE-SDK-LICENSE.txt',
    'THIRD_PARTY_NOTICES.md',
  ]) {
    await access(join(app, file));
  }
  execFileSync(join(app, 'beluga-node.exe'), [join(app, 'host/dist/main.js'), '--help'], {
    stdio: 'inherit',
  });

  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const file of [archive, installer]) {
    const name = basename(file);
    const hash = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
    await cp(file, join(output, name));
    await writeFile(join(output, `${name}.sha256`), `${hash}  ${name}\n`);
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}
