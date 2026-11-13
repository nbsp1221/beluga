import { globSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { posix, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const workspaces = new Map(
  globSync(['apps/*/package.json', 'packages/*/package.json'], {
    cwd: import.meta.dirname + '/..',
  }).map((path) => {
    const directory = posix.dirname(path.replaceAll('\\', '/'));
    const manifest = JSON.parse(
      readFileSync(new URL('../' + directory + '/package.json', import.meta.url), 'utf8'),
    );

    return [directory, manifest];
  }),
);
const byName = new Map([...workspaces].map(([directory, manifest]) => [manifest.name, directory]));
const sharedPackages = new Set(['packages/protocol', 'packages/runtime', 'packages/ui']);
const browserPackages = new Set(['apps/desktop', 'apps/web', 'packages/client', 'packages/ui']);
const hostPackages = new Set(['apps/host', 'packages/host-plugins']);
const browserFeature = /^packages\/client\/src\/(?:features\/([^/]+)|(workbench))\//;
const contractFile = /\/contract\.[cm]?[jt]sx?$/;
const hostSource = 'packages/host-plugins/src/';
const toolOperations = /^(?:filesystem|process)\//;
const toolPolicy = /^workspace\/(?:file-mutations\/|tool-access\.)/;
const piSdk = /^(?:@earendil-works\/pi-[^/]+|typebox)(?:\/|$)/;
const flue = /^@flue\//;

function workspaceOf(path) {
  return path.split('/').slice(0, 2).join('/');
}

function exportedTarget(manifest, subpath) {
  for (const [key, target] of Object.entries(manifest.exports ?? {})) {
    if (key === subpath) {
      return target;
    }

    const star = key.indexOf('*');
    if (star !== -1 && typeof target === 'string') {
      const prefix = key.slice(0, star);
      const suffix = key.slice(star + 1);
      if (
        subpath.startsWith(prefix) &&
        subpath.endsWith(suffix) &&
        subpath.length > prefix.length + suffix.length
      ) {
        return target.replace('*', subpath.slice(prefix.length, subpath.length - suffix.length));
      }
    }
  }
}

function featureOf(path) {
  const match = path.match(browserFeature);
  return match?.[1] ?? match?.[2];
}

function checkImport(source, specifier) {
  const from = workspaceOf(source);
  if (posix.isAbsolute(specifier) || win32.isAbsolute(specifier) || specifier.startsWith('file:')) {
    return 'Import through a workspace entry point or a package-local path.';
  }

  let target = specifier;
  let to;
  if (specifier.startsWith('.')) {
    target = posix.join(posix.dirname(source), specifier);
    to = workspaceOf(target);
    if (from !== to) {
      return 'Use the other package’s public entry point instead of a relative path.';
    }
  } else {
    const packageName = specifier
      .split('/')
      .slice(0, specifier.startsWith('@') ? 2 : 1)
      .join('/');
    to = byName.get(packageName);
    if (to) {
      const manifest = workspaces.get(from);
      if (
        from !== to &&
        ![
          manifest.dependencies,
          manifest.devDependencies,
          manifest.peerDependencies,
          manifest.optionalDependencies,
        ].some((dependencies) => Object.hasOwn(dependencies ?? {}, packageName))
      ) {
        return 'Declare the workspace dependency in the importing package.';
      }

      const entry = exportedTarget(workspaces.get(to), '.' + specifier.slice(packageName.length));
      if (!entry) {
        return 'Use an exported workspace entry point.';
      }
      target = typeof entry === 'string' ? posix.join(to, entry) : specifier;
    }
  }

  if (to?.startsWith('apps/') && from !== to) {
    return 'An app owns its implementation.';
  }
  const isSource = source.startsWith(from + '/src/');
  if (isSource && sharedPackages.has(from) && to && !sharedPackages.has(to)) {
    return 'Shared packages may only import shared packages.';
  }
  if (
    isSource &&
    from === 'packages/protocol' &&
    (isBuiltin(specifier) ||
      (to && to !== from) ||
      /^(?:react(?:-dom)?|@flue\/(?:runtime|sdk))(?:\/|$)/.test(specifier))
  ) {
    return 'The wire protocol must stay independent of platform and runtime implementations.';
  }
  if (
    browserPackages.has(from) &&
    (hostPackages.has(to) ||
      (isSource && (isBuiltin(specifier) || specifier.startsWith('@flue/runtime'))))
  ) {
    return 'Browser code cannot import Host or Node implementation.';
  }
  if (
    hostPackages.has(from) &&
    (browserPackages.has(to) || specifier === '@workspace/runtime/react')
  ) {
    return 'Host modules cannot import browser implementation.';
  }

  if (source.startsWith(hostSource) && !source.endsWith('.test.ts')) {
    const module = source.slice(hostSource.length);
    const dependency = target.startsWith(hostSource) ? target.slice(hostSource.length) : '';
    if (
      (toolOperations.test(module) || toolPolicy.test(module)) &&
      (piSdk.test(specifier) ||
        flue.test(specifier) ||
        /^(?:pi\/|agent-capabilities\/)/.test(dependency) ||
        (toolOperations.test(module) && dependency.startsWith('workspace/')))
    ) {
      return 'Tool contracts and Host policy must stay independent of Pi and agent registration.';
    }
    if (
      module.startsWith('pi/') &&
      (flue.test(specifier) || /^(?:agent-capabilities\/|workspace\/)/.test(dependency))
    ) {
      return 'Pi adapters must consume operation contracts and receive Host policy from their caller.';
    }
    if (module.startsWith('agent-capabilities/') && piSdk.test(specifier)) {
      return 'Agent registration must use the Pi adapter instead of importing the Pi SDK.';
    }
  }

  const sourceFeature = featureOf(source);
  const targetFeature = featureOf(target);
  if (sourceFeature && target.startsWith('packages/client/src/bootstrap/')) {
    return 'Browser features cannot import product assembly.';
  }
  if (
    sourceFeature &&
    targetFeature &&
    sourceFeature !== targetFeature &&
    !contractFile.test(target)
  ) {
    return 'Use the other browser feature’s contract.';
  }
  if (
    source.startsWith('packages/host-plugins/src/harness/') &&
    target.startsWith('packages/host-plugins/src/trajectory/') &&
    !contractFile.test(target)
  ) {
    return 'Harness must consume the Trajectory service contract.';
  }
}

export function findBoundaryViolations(source, contents) {
  const { importedFiles } = ts.preProcessFile(contents, true, true);
  return importedFiles.flatMap(({ fileName }) => {
    const message = checkImport(source, fileName);
    return message ? [`${source}: ${fileName}. ${message}`] : [];
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const sourcePatterns = [
    'src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
    'test/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
    '*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
  ];
  const root = import.meta.dirname + '/..';
  const violations = [...workspaces.keys()].flatMap((workspace) =>
    globSync(sourcePatterns, {
      cwd: root + '/' + workspace,
      exclude: ['**/node_modules/**'],
    }).flatMap((path) => {
      const source = workspace + '/' + path.replaceAll('\\', '/');
      return findBoundaryViolations(source, readFileSync(root + '/' + source, 'utf8'));
    }),
  );
  if (violations.length) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  }
}
