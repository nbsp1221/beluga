import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);

const read = (path) => readFileSync(new URL(path, root), 'utf8');
const write = (path, content) => writeFileSync(new URL(path, root), content);

const { version, packageManager } = JSON.parse(read('package.json'));
const check = process.argv.includes('--check');
const desktopPath = 'apps/desktop/package.json';
const desktop = JSON.parse(read(desktopPath));
const cargoPath = 'apps/desktop/src-tauri/Cargo.toml';
const lockPath = 'apps/desktop/src-tauri/Cargo.lock';
const crateVersion = /(?<=^name = "beluga-desktop"\r?\nversion = ")[^"]+(?=")/m;
const sources = [cargoPath, lockPath];
const tauri = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'));
const releaseVersion =
  /(?<=(?:releases\/(?:tag|download)\/v|Download v|ghcr\.io\/nbsp1221\/beluga:|^version=|Beluga_))[\dA-Za-z.+-]+(?=[\s/;_)`\]])/gm;

const release = 'https://github.com/nbsp1221/beluga/releases';
const image = `ghcr.io/nbsp1221/beluga:${version}`;
const windowsAssets = ['beluga-windows-x64-portable.zip', `Beluga_${version}_x64-setup.exe`];
const requiredReferences = {
  'README.md': [`${release}/tag/v${version})`, `\`${image}\``],
  'docs/hosting.md': [
    `\nversion=${version}; curl -fsSL "${release}/download/v$version/install.sh" | sh -s -- "$version"\n`,
    `\nimage=${image}\n`,
    ...windowsAssets.flatMap((name) => [
      `${release}/download/v${version}/${name})`,
      `${release}/download/v${version}/${name}.sha256)`,
    ]),
  ],
};

const guides = Object.entries(requiredReferences).map(([path, references]) => {
  const content = read(path);
  const updated = content.replaceAll(releaseVersion, version);
  const guide = (check ? content : updated).replaceAll('\r\n', '\n');
  if (references.some((reference) => !guide.includes(reference))) {
    throw new Error(`A required Beluga ${version} installation reference is missing from ${path}.`);
  }
  if (check && updated !== content) {
    throw new Error(`Release versions in ${path} must match Beluga ${version}.`);
  }
  return [path, updated];
});

const node = read('.node-version').trim();
const dockerfile = read('Dockerfile');
const dockerNode = [...dockerfile.matchAll(/^FROM node:([^\s@-]+)/gm)];
const linuxNode = read('scripts/package-linux.sh').match(/^node_version=([^\s]+)$/m)?.[1];
const windowsNode = read('apps/desktop/scripts/prepare-windows.mjs').match(
  /^const nodeVersion = '([^']+)';$/m,
)?.[1];
const dockerPnpm = dockerfile.match(/^RUN npm install --global (pnpm@\S+)/m)?.[1];
if (
  !node ||
  linuxNode !== node ||
  windowsNode !== node ||
  !dockerNode.length ||
  dockerNode.some(([, pin]) => pin !== node) ||
  !packageManager ||
  dockerPnpm !== packageManager
) {
  throw new Error('Packaged Node and pnpm versions must match .node-version and packageManager.');
}

if (check) {
  if (
    tauri.version !== '../package.json' ||
    desktop.version !== version ||
    sources.some((path) => read(path).match(crateVersion)?.[0] !== version)
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
  for (const [path, content] of guides) {
    write(path, content);
  }
}
