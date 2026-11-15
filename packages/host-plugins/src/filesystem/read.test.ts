import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { type TestContext, expect, test } from 'vitest';
import { read } from './read.js';

async function makeDirectory(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'beluga-read-'));
  context.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('streams the original bytes of a regular file', async (context) => {
  const absolutePath = join(await makeDirectory(context), '원본.txt');
  const contents = Buffer.concat([Buffer.from('\ufeff첫 줄\r\nsecond\n'), Buffer.from([0xff])]);
  await writeFile(absolutePath, contents);

  expect(await buffer(read({ absolutePath }))).toEqual(contents);
});

test('reports a missing file', async (context) => {
  const absolutePath = join(await makeDirectory(context), 'missing.txt');

  await expect(buffer(read({ absolutePath }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('rejects directories', async (context) => {
  const absolutePath = await makeDirectory(context);

  await expect(buffer(read({ absolutePath }))).rejects.toMatchObject({ code: 'NOT_A_FILE' });
});

test('stops consuming a file after cancellation', async (context) => {
  const absolutePath = join(await makeDirectory(context), 'file.txt');
  await writeFile(absolutePath, Buffer.alloc(256 * 1024, 65));
  const controller = new AbortController();
  const stream = read({ absolutePath }, { signal: controller.signal });

  expect((await stream.next()).done).toBe(false);
  controller.abort();

  await expect(stream.next()).rejects.toMatchObject({ code: 'ABORTED' });
});
