import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { runShell, shellName } from '../pi/shell.js';

test('returns the native shell exit code and output without a registered model tool', async () => {
  const command =
    shellName === 'pwsh' ? 'Write-Output beluga-shell; exit 7' : 'printf "beluga-shell\\n"; exit 7';
  const chunks: Buffer[] = [];

  const result = await runShell(command, tmpdir(), {
    onData: (chunk) => chunks.push(chunk),
    timeout: 10,
  });

  expect(result.exitCode).toBe(7);
  expect(Buffer.concat(chunks).toString('utf8').trim()).toBe('beluga-shell');
});
