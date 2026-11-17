import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const packageDirectory = resolve(process.argv[2]);
const fromCli = createRequire(resolve(packageDirectory, 'package.json'));
const fromHost = createRequire(fromCli.resolve('@workspace/host-server'));
const { createRuntime } = await import(pathToFileURL(fromHost.resolve('@workspace/runtime')).href);
const { fileReadCapability } = await import(
  pathToFileURL(fromHost.resolve('@workspace/host-plugins/agent-capabilities/file/read')).href
);

const runtime = await createRuntime([fileReadCapability.plugin]);
try {
  const capability = runtime.get(fileReadCapability.service);
  assert.equal(capability.createTools({ cwd: packageDirectory }).length, 1);
} finally {
  await runtime.dispose();
}

console.log('Packaged Host initialized the Standard preset read tool.');
