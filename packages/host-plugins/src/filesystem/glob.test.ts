import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { glob } from '../pi/glob.js';

test('finds matching paths without a registered model tool', async (context) => {
  const cwd = await mkdtemp(join(tmpdir(), 'beluga-glob-'));
  context.onTestFinished(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, 'note.txt'), '');
  await writeFile(join(cwd, 'ignored.md'), '');

  expect(await glob(cwd, { pattern: '*.txt' })).toBe('note.txt');
});
