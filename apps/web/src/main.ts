import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareProfile } from './profile.ts';

const require = createRequire(import.meta.url);
const cli = require.resolve('@deepseek-ai/dsh/lib/bin.js');
const application = dirname(dirname(fileURLToPath(import.meta.url)));
const home = process.env.DSH_HOME || join(homedir(), '.beluga');
const env = { ...process.env, DSH_HOME: home };

const args = process.argv.slice(2);
const inspectionFlags = [
  '--dump-config',
  '--dump-default-config',
  '--dump-config-schema',
  '--help',
  '-h',
  '--version',
  '-V',
];

if (!args.some((arg) => inspectionFlags.includes(arg))) {
  prepareProfile(cli, home, application, env);
}

const child = spawn(process.execPath, [cli, 'web', ...args], { env, stdio: 'inherit' });
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
