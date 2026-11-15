import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { edit } from '../pi/edit.js';

test('edits a file without a registered model tool', async (context) => {
  const cwd = await mkdtemp(join(tmpdir(), 'beluga-edit-'));
  context.onTestFinished(() => rm(cwd, { recursive: true, force: true }));
  const path = 'note.txt';

  await writeFile(join(cwd, path), 'draft\r\nsecond\r\n');
  await edit(cwd, {
    path,
    edits: [
      { oldText: 'draft', newText: 'ready' },
      { oldText: 'second', newText: 'third' },
    ],
  });

  expect(await readFile(join(cwd, path), 'utf8')).toBe('ready\r\nthird\r\n');
});
