import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);

const read = (path) => readFileSync(new URL(path, root), 'utf8');

const { packageManager } = JSON.parse(read('package.json'));
const node = read('.node-version').trim();
const dockerfile = read('Dockerfile');
const dockerNode = [...dockerfile.matchAll(/^FROM node:([^\s@-]+)/gm)];
const windowsNode = read('apps/desktop/scripts/prepare-windows.mjs').match(
  /^const nodeVersion = '([^']+)';$/m,
)?.[1];
const dockerPnpm = dockerfile.match(/^RUN npm install --global (pnpm@\S+)/m)?.[1];
if (
  !node ||
  windowsNode !== node ||
  !dockerNode.length ||
  dockerNode.some(([, pin]) => pin !== node) ||
  !packageManager ||
  dockerPnpm !== packageManager
) {
  throw new Error('Packaged Node and pnpm versions must match .node-version and packageManager.');
}
