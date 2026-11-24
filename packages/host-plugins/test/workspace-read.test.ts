import assert from 'node:assert/strict';
import { link, symlink, writeFile } from 'node:fs/promises';
import { join, parse, relative, sep } from 'node:path';
import { trajectoryModelInputResponseSchema } from '@workspace/protocol/host';
import { expect, test } from 'vitest';
import {
  linkDirectory,
  origin,
  readToolResult,
  readTrajectory,
  resultText,
  setupHarness,
} from './fixtures/harness.js';

test('distinguishes a missing workspace identifier from an unknown workspace', async (context) => {
  const { prepareWorkspace, post, createPreset } = await setupHarness(context);
  await prepareWorkspace();
  const preset = await createPreset();
  expect(
    (
      await post('/api/conversations', {
        workspaceId: '',
        agentPresetId: preset.id,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await post('/api/conversations', {
        workspaceId: 'beluga',
        agentPresetId: preset.id,
      })
    ).status,
  ).toBe(404);
});

test(
  'uses the registered preset and workspace for file reads',
  { timeout: 30_000 },
  async (context) => {
    const { other, prepareWorkspace, registerWorkspace, post, create, createPreset, turn } =
      await setupHarness(context);
    const workspace = await prepareWorkspace();
    const otherWorkspace = await registerWorkspace(other);
    const plainPreset = await createPreset();
    const readPreset = await createPreset(['file.read']);
    const plain = await create(workspace.id, plainPreset.id);
    const coding = await create(workspace.id, readPreset.id);
    const reading = await create(workspace.id, readPreset.id);
    const forged = await create(otherWorkspace.id, readPreset.id);
    expect(plain.agentPresetId).toBe(plainPreset.id);
    expect(coding.agentPresetVersion).toBe(1);
    expect(resultText(readToolResult(await turn(coding.id, 'README.md')))).toMatch(
      /project README/,
    );
    expect(reading.agentPresetId).toBe(readPreset.id);
    expect(
      (
        await post('/api/conversations', {
          workspaceId: workspace.id,
          agentPresetId: plainPreset.id,
          workspaceRead: true,
        })
      ).status,
    ).toBe(400);
    expect(plain.agentPresetCapabilities).toEqual([]);
    expect(reading.agentPresetCapabilities).toEqual(['file.read']);
    expect((await turn(plain.id, 'README.md', { sessionId: reading.id }))[0].toolNames).toEqual([
      'task',
    ]);
    const readme = readToolResult(
      await turn(reading.id, 'README.md', { sessionId: forged.id }, { limit: 2 }),
    );
    expect(readme.isError).toBe(false);
    expect(JSON.parse(resultText(readme))).toContain('project README\nsecond line');
  },
);

test(
  'restores successful and failed read calls and their model input after restart',
  { timeout: 30_000 },
  async (context) => {
    const { project, outside, prepareWorkspace, create, createPreset, turn, fetch, restart } =
      await setupHarness(context);
    await writeFile(join(project, 'AGENTS.md'), 'workspace instruction marker');
    const workspace = await prepareWorkspace();
    const preset = await createPreset(['file.read']);
    const reading = await create(workspace.id, preset.id);
    readToolResult(await turn(reading.id, 'README.md', undefined, { limit: 2 }));
    const trajectory = origin + '/api/conversations/' + reading.id + '/trajectory';
    const history = await readTrajectory(fetch(trajectory));
    const submission = history.find(({ records }) => records.some(({ kind }) => kind === 'tool'));
    const call = submission?.records.find((record) => record.kind === 'tool');
    assert(submission && call?.kind === 'tool' && call.modelRequestId);
    const modelInputPath = trajectory + '/' + submission.id + '/' + call.modelRequestId;
    const request = await fetch(modelInputPath);
    const input = trajectoryModelInputResponseSchema.parse(await request.json());
    const recordedRead = input.tools.find(({ name }) => name === 'read');
    expect(recordedRead?.description).toMatch(/read.*file/i);
    expect(recordedRead?.parameters).toMatchObject({
      properties: { offset: { type: 'number' }, limit: { type: 'number' } },
    });
    expect(call.schema).toEqual(recordedRead?.parameters);
    expect(call.input).toEqual({ path: 'README.md', limit: 2 });
    expect(JSON.stringify(call.output)).toContain('project README');
    expect(call.status).toBe('completed');
    expect(input.systemPrompt).not.toContain('Working directory:');
    expect(JSON.stringify(input)).not.toContain('workspace instruction marker');

    const missing = readToolResult(await turn(reading.id, '../other/missing.txt'));
    expect(missing.isError).toBe(true);
    expect(resultText(missing)).not.toContain(outside);
    const beforeRestart = await readTrajectory(fetch(trajectory));
    expect(
      beforeRestart.some(({ records }) =>
        records.some((record) => record.kind === 'tool' && record.status === 'failed'),
      ),
    ).toBe(true);

    await restart();

    expect(await readTrajectory(fetch(trajectory))).toEqual(beforeRestart);
    expect(
      trajectoryModelInputResponseSchema.parse(await (await fetch(modelInputPath)).json()),
    ).toEqual(input);
  },
);

test('applies the requested line ranges to file reads', async (context) => {
  const { project, prepareWorkspace, create, createPreset, turn } = await setupHarness(context);
  const workspace = await prepareWorkspace();
  const preset = await createPreset(['file.read']);
  const reading = await create(workspace.id, preset.id);
  const next = readToolResult(
    await turn(reading.id, 'README.md', undefined, { offset: 3, limit: 1 }),
  );
  expect(JSON.parse(resultText(next))).toContain('third line');

  const aliases = join(project, 'pi-path.txt');
  await writeFile(aliases, 'first\nsecond\nthird');
  const piRange = readToolResult(await turn(reading.id, '@pi-path.txt', undefined, { limit: -1 }));
  const piRangeText: unknown = JSON.parse(resultText(piRange));
  expect(piRangeText).toContain('first\nsecond');
  expect(piRangeText).not.toContain('third');
});

test('bounds read output and returns a continuation offset when possible', async (context) => {
  const { project, prepareWorkspace, create, createPreset, turn } = await setupHarness(context);
  await Promise.all([
    writeFile(join(project, 'unicode.txt'), ('\uD55C'.repeat(100) + '\n').repeat(200)),
    writeFile(join(project, 'long.txt'), 'line\n'.repeat(2_001)),
    writeFile(join(project, 'large.txt'), 'a'.repeat(1_048_577)),
  ]);
  const workspace = await prepareWorkspace();
  const preset = await createPreset(['file.read']);
  const reading = await create(workspace.id, preset.id);
  const long = readToolResult(await turn(reading.id, 'long.txt'));
  expect(resultText(long)).toContain('Use offset=2001 to continue.');
  const unicode = readToolResult(await turn(reading.id, 'unicode.txt'));
  expect(unicode.isError).toBe(false);
  const unicodeText: unknown = JSON.parse(resultText(unicode));
  assert(typeof unicodeText === 'string');
  expect(Buffer.byteLength(unicodeText, 'utf8')).toBeLessThan(52_000);
  const smaller = readToolResult(await turn(reading.id, 'unicode.txt', undefined, { limit: 100 }));
  expect(smaller.isError).toBe(false);
  expect(JSON.parse(resultText(smaller))).toContain('Use offset=101 to continue.');
  const large = readToolResult(await turn(reading.id, 'large.txt'));
  expect(large.isError).toBe(false);
  expect(JSON.parse(resultText(large))).toBe('[The requested line exceeds 50.0KB limit.]');
});

test('reads nested files in the registered workspace', async (context) => {
  const { prepareWorkspace, create, createPreset, turn } = await setupHarness(context);
  const workspace = await prepareWorkspace();
  const preset = await createPreset(['file.read']);
  const reading = await create(workspace.id, preset.id);
  const notes = readToolResult(await turn(reading.id, 'docs/notes.txt'));
  expect(resultText(notes)).toMatch(/other in-project file/);
});

test.for([
  '../other/README.md',
  'alias/README.md',
  'hardlink.txt',
  'absolute external path',
  ...(process.platform === 'win32' ? [] : ['symlink.txt']),
])('reads fixture content through %s', async (path, context) => {
  const { outside, other, project, prepareWorkspace, create, createPreset, turn } =
    await setupHarness(context);
  if (path === 'alias/README.md') {
    await linkDirectory(other, join(project, 'alias'));
  } else if (path === 'hardlink.txt') {
    await link(outside, join(project, path));
  } else if (path === 'symlink.txt') {
    await symlink(outside, join(project, path));
  }
  const workspace = await prepareWorkspace();
  const preset = await createPreset(['file.read']);
  const reading = await create(workspace.id, preset.id);
  const target = path === 'absolute external path' ? outside.split(sep).join('/') : path;
  const result = readToolResult(await turn(reading.id, target));
  expect(result.isError).toBe(false);
  expect(resultText(result)).toContain('outside marker');
});

test('opens a file relative to a registered filesystem root', async (context) => {
  const { project, prepareWorkspace, registerWorkspace, create, createPreset, turn } =
    await setupHarness(context);
  const diskRoot = parse(project).root;
  await prepareWorkspace();
  const disk = await registerWorkspace(diskRoot);
  const preset = await createPreset(['file.read']);
  const diskChat = await create(disk.id, preset.id);
  const result = readToolResult(
    await turn(diskChat.id, relative(diskRoot, join(project, 'README.md')).split(sep).join('/')),
  );
  expect(result.isError).toBe(false);
  expect(resultText(result)).toMatch(/project README/);
});
