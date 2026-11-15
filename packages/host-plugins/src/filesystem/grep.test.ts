import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { grep } from '../pi/grep.js';

test('searches file contents without a registered model tool', async (context) => {
  const cwd = await mkdtemp(join(tmpdir(), 'beluga-grep-'));
  context.onTestFinished(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, 'note.txt'), 'first\nsearch marker\n');
  await writeFile(join(cwd, 'ignored.md'), 'search marker\n');

  expect(await grep(cwd, { pattern: 'search marker', glob: '*.txt', literal: true })).toBe(
    'note.txt:2: search marker',
  );
});
