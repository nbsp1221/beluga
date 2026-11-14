import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);

const read = (path) => readFileSync(new URL(path, root), 'utf8');
const write = (path, content) => writeFileSync(new URL(path, root), content);

const { version } = JSON.parse(read('package.json'));
const desktopPath = 'apps/desktop/package.json';
const desktop = JSON.parse(read(desktopPath));
const cargoPath = 'apps/desktop/src-tauri/Cargo.toml';
const lockPath = 'apps/desktop/src-tauri/Cargo.lock';
const crateVersion = /(?<=^name = "beluga-desktop"\r?\nversion = ")[^"]+(?=")/m;
const sources = [cargoPath, lockPath];
const tauri = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'));
const guides = ['README.md', 'docs/hosting.md'];
const releaseVersion =
  /(?<=(?:releases\/(?:tag|download)\/v|Download v|ghcr\.io\/nbsp1221\/beluga:|version=|Beluga_))\d+\.\d+\.\d+(?:-[\da-z.]+)?(?=[\s/_)`\]])/gi;

const requiredReferences = {
  'README.md': [/releases\/tag\/v/, /ghcr\.io\/nbsp1221\/beluga:/],
  'docs/hosting.md': [
    /^version=/m,
    /\/beluga-windows-x64-portable\.zip\)/,
    /\/beluga-windows-x64-portable\.zip\.sha256\)/,
    /\/Beluga_[^/]+_x64-setup\.exe\)/,
    /\/Beluga_[^/]+_x64-setup\.exe\.sha256\)/,
    /ghcr\.io\/nbsp1221\/beluga:/,
  ],
};

for (const path of guides) {
  const content = read(path);
  if (requiredReferences[path].some((pattern) => !pattern.test(content))) {
    throw new Error('A required installation reference is missing from ' + path + '.');
  }
}

if (process.argv.includes('--check')) {
  if (
    tauri.version !== '../package.json' ||
    desktop.version !== version ||
    sources.some((path) => read(path).match(crateVersion)?.[0] !== version) ||
    guides.some((path) => read(path).replace(releaseVersion, version) !== read(path))
  ) {
    throw new Error(`Desktop metadata and installation links must match Beluga ${version}.`);
  }
} else {
  desktop.version = version;
  write(desktopPath, `${JSON.stringify(desktop, null, 2)}\n`);
  for (const path of sources) {
    const content = read(path);
    if (!crateVersion.test(content)) {
      throw new Error(`Beluga desktop version is missing from ${path}.`);
    }
    write(path, content.replace(crateVersion, version));
  }
  for (const path of guides) {
    write(path, read(path).replace(releaseVersion, version));
  }
}
