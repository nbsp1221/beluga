import { mkdir, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { workspaceInstructionsRootError } from '@workspace/protocol/host';
import { expect, test } from 'vitest';
import { allCapabilities, origin, readTrajectory, setupHarness } from './fixtures/harness.js';

test('only selected presets discover instructions and record when they enter model requests', async (context) => {
  const harness = await setupHarness(context);
  const { create, createPreset, databasePath, other, project, prepareWorkspace, restart, turn } =
    harness;
  const globalFile = join(dirname(databasePath), 'AGENTS.md');
  const nestedFile = join(project, 'docs', 'AGENTS.md');
  await mkdir(join(project, 'unvisited'));
  await Promise.all([
    writeFile(join(project, '.git'), 'gitdir: /fixture/worktree'),
    writeFile(globalFile, 'FIXTURE_GLOBAL_RULE'),
    writeFile(join(project, 'AGENTS.md'), 'FIXTURE_ROOT_RULE'),
    writeFile(join(project, 'AGENTS.override.md'), 'FIXTURE_ROOT_OVERRIDE'),
    writeFile(nestedFile, 'FIXTURE_NESTED_RULE'),
    writeFile(join(project, 'CLAUDE.md'), 'FIXTURE_CLAUDE_RULE'),
    writeFile(join(project, 'unvisited', 'AGENTS.md'), 'FIXTURE_UNVISITED_RULE'),
    writeFile(join(other, 'AGENTS.md'), 'FIXTURE_OTHER_RULE'),
  ]);
  const workspace = await prepareWorkspace();
  const chatPreset = await createPreset();
  const chat = await create(workspace.id, chatPreset.id);
  const [plain] = await turn(chat.id, 'README.md');
  expect(plain.workspaceInstructions).toBe('');
  const preset = await createPreset(['agent-instructions', 'file.read']);
  const session = await create(workspace.id, preset.id);

  const [first, afterTool] = await turn(session.id, 'docs/notes.txt');
  expect(first.instructions).not.toContain('FIXTURE_GLOBAL_RULE');
  expect(first.workspaceInstructions).toMatch(/FIXTURE_GLOBAL_RULE[\s\S]*FIXTURE_ROOT_OVERRIDE/);
  expect(first.workspaceInstructions).not.toMatch(
    /FIXTURE_(ROOT_RULE|NESTED|UNVISITED|CLAUDE|OTHER)/,
  );
  expect(afterTool.workspaceInstructions.match(/FIXTURE_NESTED_RULE/g)).toHaveLength(1);

  const [, repeated] = await turn(session.id, 'docs/notes.txt');
  expect(repeated.workspaceInstructions.match(/FIXTURE_NESTED_RULE/g)).toHaveLength(1);
  const [, external] = await turn(session.id, '../other/README.md');
  expect(external.result?.isError).toBe(false);
  expect(external.workspaceInstructions).not.toContain('FIXTURE_OTHER_RULE');
  const [, linked] = await turn(session.id, 'alias/README.md');
  expect(linked.result?.isError).toBe(false);
  expect(linked.workspaceInstructions).not.toContain('FIXTURE_OTHER_RULE');

  const trajectory = origin + '/api/conversations/' + session.id + '/trajectory';
  const records = (await readTrajectory(harness.fetch(trajectory))).flatMap(
    ({ records }) => records,
  );
  const contexts = records.filter((record) => record.kind === 'context');
  expect(contexts.map(({ text }) => text)).toEqual([
    'Host AGENTS.md, AGENTS.override.md',
    'docs/AGENTS.md',
  ]);
  const nested = contexts.find(({ text }) => text === 'docs/AGENTS.md');
  expect(nested).toMatchObject({ changes: [{ action: 'add', path: 'docs/AGENTS.md' }] });
  expect(records.find(({ id }) => id === nested?.modelRequestId)?.kind).toBe('assistant');
  expect(await readTrajectory(harness.fetch(trajectory + '?q=docs%2Fagents.md'))).toHaveLength(1);

  await writeFile(globalFile, 'FIXTURE_UPDATED_GLOBAL');
  await restart();
  const [restored] = await turn(session.id, 'README.md');
  expect(restored.workspaceInstructions).toContain('FIXTURE_UPDATED_GLOBAL');
  expect(restored.workspaceInstructions.match(/FIXTURE_NESTED_RULE/g)).toHaveLength(1);
  await unlink(nestedFile);
  const [, afterRemoval] = await turn(session.id, 'README.md');
  expect(afterRemoval.workspaceInstructions).toContain('Instructions removed: "docs/AGENTS.md"');

  await writeFile(nestedFile, 'FIXTURE_REDISCOVERED_RULE');
  const [, rediscovered] = await turn(session.id, 'docs/notes.txt');
  expect(rediscovered.workspaceInstructions).toContain('FIXTURE_REDISCOVERED_RULE');
  await rename(join(project, 'docs'), join(project, 'original-docs'));
  await symlink(other, join(project, 'docs'), 'junction');
  const [, afterFolderReplacement] = await turn(session.id, 'README.md');
  expect(afterFolderReplacement.workspaceInstructions).not.toContain('FIXTURE_OTHER_RULE');
  const allRecords = (await readTrajectory(harness.fetch(trajectory))).flatMap(
    ({ records }) => records,
  );
  expect(allRecords.filter((record) => record.kind === 'context').at(-1)?.changes).toEqual([
    { action: 'remove', path: 'docs/AGENTS.md' },
  ]);
});

test('keeps Host instructions separate from project instructions in a folder named Host', async (context) => {
  const harness = await setupHarness(context);
  const folder = join(harness.project, 'Host');
  await mkdir(folder);
  await Promise.all([
    writeFile(join(dirname(harness.databasePath), 'AGENTS.md'), 'FIXTURE_GLOBAL_RULE'),
    writeFile(join(folder, 'AGENTS.md'), 'FIXTURE_LOCAL_RULE'),
    writeFile(join(folder, 'notes.txt'), 'Fixture file'),
  ]);
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset(['agent-instructions', 'file.read']);
  const session = await harness.create(workspace.id, preset.id);
  const [first, second] = await harness.turn(session.id, 'Host/notes.txt');
  expect(first.workspaceInstructions).toContain('FIXTURE_GLOBAL_RULE');
  expect(first.workspaceInstructions).not.toContain('FIXTURE_LOCAL_RULE');
  expect(second.workspaceInstructions).toMatch(/FIXTURE_GLOBAL_RULE[\s\S]*FIXTURE_LOCAL_RULE/);

  const trajectory = origin + '/api/conversations/' + session.id + '/trajectory';
  const records = (await readTrajectory(harness.fetch(trajectory))).flatMap(
    ({ records }) => records,
  );
  expect(
    records.filter((record) => record.kind === 'context').flatMap((record) => record.changes),
  ).toEqual([
    { action: 'add', path: 'Host AGENTS.md' },
    { action: 'add', path: 'Host/AGENTS.md' },
  ]);
});

test('loads instructions after successful writes and cuts UTF-8 at the project budget', async (context) => {
  const harness = await setupHarness(context, allCapabilities);
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset(['agent-instructions', 'file.read', 'file.write']);
  const session = await harness.create(workspace.id, preset.id, 'workspace-write');
  const file = join(harness.project, 'docs', 'AGENTS.md');
  await writeFile(join(harness.project, 'AGENTS.md'), 'FIXTURE_PROJECT');
  await writeFile(file, 'FIXTURE_WRITE_SCOPE');
  const client = harness.sdk(session.id);
  const receipt = await client.send({
    message: {
      kind: 'user',
      body: JSON.stringify({ tool: 'write', path: 'docs/new.txt', content: 'new file' }),
    },
    idempotencyKey: crypto.randomUUID(),
  });
  await client.wait(receipt, { signal: AbortSignal.timeout(5_000) });
  const [first, afterWrite] = harness.observed;
  expect(first.workspaceInstructions).not.toContain('FIXTURE_WRITE_SCOPE');
  expect(afterWrite.workspaceInstructions).toMatch(/FIXTURE_PROJECT[\s\S]*FIXTURE_WRITE_SCOPE/);
  expect(afterWrite.result?.isError).toBe(false);
  expect(JSON.stringify(afterWrite.result)).not.toContain('FIXTURE_WRITE_SCOPE');

  await writeFile(file, '가'.repeat(24_000) + 'FIXTURE_BEYOND_LIMIT');
  const [, bounded] = await harness.turn(session.id, 'README.md');
  expect(bounded.workspaceInstructions).toContain('docs/AGENTS.md" (truncated)');
  expect(bounded.workspaceInstructions).toContain('omitted due to the size limit');
  expect(bounded.workspaceInstructions).not.toMatch(/FIXTURE_BEYOND_LIMIT|�/);
  const trajectory = origin + '/api/conversations/' + session.id + '/trajectory';
  const records = (await readTrajectory(harness.fetch(trajectory))).flatMap(
    ({ records }) => records,
  );
  const update = records.findLast((record) => record.kind === 'context');
  expect(Buffer.byteLength(update?.body ?? '')).toBeLessThanOrEqual(64 * 1024);
  await harness.turn(session.id, 'docs/new.txt');
  const repeated = (await readTrajectory(harness.fetch(trajectory))).flatMap(
    ({ records }) => records,
  );
  expect(repeated.filter((record) => record.kind === 'context').map(({ id }) => id)).toEqual(
    records.filter((record) => record.kind === 'context').map(({ id }) => id),
  );
});

test('stops before the model when the registered workspace root can no longer be resolved', async (context) => {
  const harness = await setupHarness(context);
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset(['agent-instructions']);
  const session = await harness.create(workspace.id, preset.id);
  await writeFile(join(harness.project, 'AGENTS.md'), 'FIXTURE_ROOT_RULE');
  await harness.turn(session.id, 'README.md');
  const before = harness.observed.length;
  await rename(harness.project, join(dirname(harness.project), 'relocated-project'));
  const client = harness.sdk(session.id);
  const receipt = await client.send({
    message: { kind: 'user', body: 'Try again.' },
    idempotencyKey: crypto.randomUUID(),
  });
  await expect(client.wait(receipt, { signal: AbortSignal.timeout(5_000) })).rejects.toThrow(
    workspaceInstructionsRootError.message,
  );
  expect(harness.observed).toHaveLength(before);
  const history = await client.history();
  expect(history.settlements.at(-1)?.error).toMatchObject(workspaceInstructionsRootError);
});

test('stops a running response if file discovery cannot identify the project root', async (context) => {
  let marker: string;
  const harness = await setupHarness(context, undefined, async () => {
    await symlink(marker, marker, process.platform === 'win32' ? 'junction' : 'dir');
  });
  marker = join(harness.project, '.git');
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset(['agent-instructions', 'file.read']);
  const session = await harness.create(workspace.id, preset.id);
  await expect(harness.turn(session.id, 'docs/notes.txt')).rejects.toThrow(
    workspaceInstructionsRootError.message,
  );
  expect(harness.observed).toHaveLength(1);
});
