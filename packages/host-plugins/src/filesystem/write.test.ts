import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { write } from '../pi/write.js';

test('creates parent folders and writes a file without a registered model tool', async (context) => {
  const cwd = await mkdtemp(join(tmpdir(), 'beluga-write-'));
  context.onTestFinished(() => rm(cwd, { recursive: true, force: true }));
  const path = 'nested/note.txt';
  const content = 'draft\r\nsecond\r\n';

  await write(cwd, { path, content });

  expect(await readFile(join(cwd, path), 'utf8')).toBe(content);
});
