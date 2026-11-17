import { parseArgs } from 'node:util';
import { startDesktopHost } from './desktop.js';

const usage = 'Beluga Desktop Host --data-dir DIR --web-dir DIR';

async function start() {
  const { values } = parseArgs({
    options: {
      'data-dir': { type: 'string' },
      'web-dir': { type: 'string' },
      'help': { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }

  if (!values['data-dir'] || !values['web-dir']) {
    throw new Error(usage);
  }
  await startDesktopHost(values['data-dir'], values['web-dir']);
}

void start().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
