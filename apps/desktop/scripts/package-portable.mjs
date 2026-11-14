import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const tauri = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const runtime = join(tauri, 'dist', 'runtime');
const release = join(tauri, 'target', 'release');
const output = join(release, 'bundle', 'portable');
const archiveName = 'beluga-windows-x64-portable.zip';
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
  const hash = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex');
  await mkdir(output, { recursive: true });
  await cp(archive, join(output, archiveName));
  await writeFile(join(output, `${archiveName}.sha256`), `${hash}  ${archiveName}\n`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
