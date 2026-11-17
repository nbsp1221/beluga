#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { initializeAccessCode, resolveDataDir, startServer } from '@workspace/host-server';
import { Command, Option } from 'commander';
import { installService, notifyServiceReady } from './service.js';

const manifest: unknown = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
if (
  !manifest ||
  typeof manifest !== 'object' ||
  !('version' in manifest) ||
  typeof manifest.version !== 'string'
) {
  throw new Error('The Beluga package version is missing.');
}
const program = new Command('beluga')
  .description('Run a Beluga Host.')
  .version(manifest.version)
  .showHelpAfterError();

interface ServeOptions {
  bind?: string;
  port?: string;
  origin?: string;
  dataDir?: string;
  webDir?: string;
}

program
  .command('serve')
  .description('Run the Host in the foreground.')
  .addOption(
    new Option('--bind <address>', 'address to listen on (default: 127.0.0.1)').env('BELUGA_BIND'),
  )
  .addOption(new Option('--port <number>', 'port to listen on (default: 8917)').env('PORT'))
  .addOption(
    new Option('--origin <url>', 'browser address (default: local URL)').env('BELUGA_ORIGIN'),
  )
  .option('--data-dir <directory>', 'Host data directory')
  .option('--web-dir <directory>', 'serve these web assets instead of the bundled site')
  .action(async (options: ServeOptions) => {
    await startServer({
      bind: options.bind,
      port: options.port,
      origin: options.origin,
      dataDir: resolveDataDir(options.dataDir),
      webDir: resolve(options.webDir ?? join(import.meta.dirname, 'web')),
      onListening: () => notifyServiceReady(process.env),
    });
  });

const auth = program.command('auth').description('Manage the Host access code.');
for (const command of ['init', 'rotate'] as const) {
  auth
    .command(command)
    .description(command === 'init' ? 'Create the first access code.' : 'Replace the access code.')
    .option('--data-dir <directory>', 'Host data directory')
    .action(async ({ dataDir }: { dataDir?: string }) => {
      const code = await initializeAccessCode(resolveDataDir(dataDir), command === 'rotate');
      console.log(`Beluga access code: ${code}`);
    });
}

program
  .command('service')
  .description('Manage the Linux user service.')
  .command('install')
  .description('Install and start the systemd user service.')
  .option('--boot', 'start at boot and keep running after logout')
  .action(async ({ boot }: { boot?: boolean }) => {
    await installService(import.meta.filename, Boolean(boot), process.env);
  });

await program.parseAsync().catch((error: unknown) => {
  program.error(error instanceof Error ? error.message : String(error));
});
