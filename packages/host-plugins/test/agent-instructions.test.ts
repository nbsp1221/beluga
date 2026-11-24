import assert from 'node:assert/strict';
import { mkdir, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { workspaceInstructionsRootError } from '@workspace/protocol/host';
import { type TestContext, expect, test } from 'vitest';
import {
  allCapabilities,
  linkDirectory,
  origin,
  readTrajectory,
  setupHarness,
} from './fixtures/harness.js';

async function startSession(
  harness: Awaited<ReturnType<typeof setupHarness>>,
  capabilities = ['agent-instructions', 'file.read'],
) {
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset(capabilities);
  return harness.create(workspace.id, preset.id);
}

async function trajectoryRecords(
  harness: Awaited<ReturnType<typeof setupHarness>>,
  sessionId: string,
) {
  const url = `${origin}/api/conversations/${sessionId}/trajectory`;
  return (await readTrajectory(harness.fetch(url))).flatMap(({ records }) => records);
}

async function setupNestedInstructions(context: TestContext) {
  const harness = await setupHarness(context);
  const nestedFile = join(harness.project, 'docs', 'AGENTS.md');
  await writeFile(nestedFile, 'FIXTURE_NESTED_RULE');
  return { harness, nestedFile, session: await startSession(harness) };
}

test('omits workspace instructions when the preset does not select the capability', async (context) => {
  const harness = await setupHarness(context);
  await writeFile(join(harness.project, 'AGENTS.md'), 'FIXTURE_ROOT_RULE');
  const session = await startSession(harness, []);
  const [request] = await harness.turn(session.id, 'README.md');
  expect(request.workspaceInstructions).toBe('');
  expect(request.instructions).not.toContain('FIXTURE_ROOT_RULE');
});

test('applies Host instructions before the workspace override in the initial model context', async (context) => {
  const harness = await setupHarness(context);
  const { project, databasePath } = harness;
  await mkdir(join(project, 'unvisited'));
  await Promise.all([
    writeFile(join(project, '.git'), 'gitdir: /fixture/worktree'),
    writeFile(join(dirname(databasePath), 'AGENTS.md'), 'FIXTURE_GLOBAL_RULE'),
    writeFile(join(project, 'AGENTS.md'), 'FIXTURE_ROOT_RULE'),
    writeFile(join(project, 'AGENTS.override.md'), 'FIXTURE_ROOT_OVERRIDE'),
    writeFile(join(project, 'docs', 'AGENTS.md'), 'FIXTURE_NESTED_RULE'),
    writeFile(join(project, 'CLAUDE.md'), 'FIXTURE_CLAUDE_RULE'),
    writeFile(join(project, 'unvisited', 'AGENTS.md'), 'FIXTURE_UNVISITED_RULE'),
  ]);
  const session = await startSession(harness);
  const [first, afterTool] = await harness.turn(session.id, 'docs/notes.txt');
  expect(first.instructions).not.toContain('FIXTURE_GLOBAL_RULE');
  expect(first.workspaceInstructions).toMatch(/FIXTURE_GLOBAL_RULE[\s\S]*FIXTURE_ROOT_OVERRIDE/);
  expect(first.workspaceInstructions).not.toMatch(/FIXTURE_(ROOT_RULE|NESTED|UNVISITED|CLAUDE)/);
  const records = await trajectoryRecords(harness, session.id);
  expect(afterTool.workspaceInstructions.match(/FIXTURE_NESTED_RULE/g)).toHaveLength(1);
  expect(records.filter((record) => record.kind === 'context').map(({ text }) => text)).toEqual([
    'Host AGENTS.md, AGENTS.override.md',
    'docs/AGENTS.md',
  ]);
});

test('discovers nested instructions on access and traces their first application', async (context) => {
  const { harness, session } = await setupNestedInstructions(context);
  const [first, afterTool] = await harness.turn(session.id, 'docs/notes.txt');
  expect(first.workspaceInstructions).not.toContain('FIXTURE_NESTED_RULE');
  expect(afterTool.workspaceInstructions.match(/FIXTURE_NESTED_RULE/g)).toHaveLength(1);
  const records = await trajectoryRecords(harness, session.id);
  const contexts = records.filter((record) => record.kind === 'context');
  const nested = contexts.find(({ text }) => text === 'docs/AGENTS.md');
  expect(nested).toMatchObject({ changes: [{ action: 'add', path: 'docs/AGENTS.md' }] });
  expect(records.find(({ id }) => id === nested?.modelRequestId)?.kind).toBe('assistant');
  const url = `${origin}/api/conversations/${session.id}/trajectory?q=docs%2Fagents.md`;
  const matches = await readTrajectory(harness.fetch(url));
  expect(matches).toHaveLength(1);
  expect(matches[0].records).toContainEqual(nested);
});

test('applies and records unchanged nested instructions only once', async (context) => {
  const { harness, session } = await setupNestedInstructions(context);
  await harness.turn(session.id, 'docs/notes.txt');
  const [, repeated] = await harness.turn(session.id, 'docs/notes.txt');
  expect(repeated.workspaceInstructions.match(/FIXTURE_NESTED_RULE/g)).toHaveLength(1);
  const records = await trajectoryRecords(harness, session.id);
  expect(
    records.filter((record) => record.kind === 'context' && record.text === 'docs/AGENTS.md'),
  ).toHaveLength(1);
});

test.for([
  { name: 'a relative path', path: '../other/README.md' },
  { name: 'a directory link', path: 'alias/README.md' },
  { name: 'an absolute path', path: null },
])(
  'does not discover instructions outside the workspace when reading $name',
  async ({ path }, context) => {
    const harness = await setupHarness(context);
    await writeFile(join(harness.other, 'AGENTS.md'), 'FIXTURE_OTHER_RULE');
    if (path === 'alias/README.md') {
      await linkDirectory(harness.other, join(harness.project, 'alias'));
    }
    const session = await startSession(harness);
    const [, afterTool] = await harness.turn(session.id, path ?? harness.outside);
    expect(afterTool.result?.isError).toBe(false);
    expect(afterTool.workspaceInstructions).not.toContain('FIXTURE_OTHER_RULE');
  },
);

test('reloads Host instructions and restores previously discovered scopes after restart', async (context) => {
  const { harness, session } = await setupNestedInstructions(context);
  const globalFile = join(dirname(harness.databasePath), 'AGENTS.md');
  await writeFile(globalFile, 'FIXTURE_GLOBAL_RULE');
  await harness.turn(session.id, 'docs/notes.txt');
  await writeFile(globalFile, 'FIXTURE_UPDATED_GLOBAL');
  await harness.restart();
  const [restored] = await harness.turn(session.id, 'README.md');
  expect(restored.workspaceInstructions).toContain('FIXTURE_UPDATED_GLOBAL');
  expect(restored.workspaceInstructions.match(/FIXTURE_NESTED_RULE/g)).toHaveLength(1);
});

test('removes a deleted instruction file and rediscovers it on later access', async (context) => {
  const { harness, nestedFile, session } = await setupNestedInstructions(context);
  await harness.turn(session.id, 'docs/notes.txt');
  await unlink(nestedFile);
  const [, afterRemoval] = await harness.turn(session.id, 'README.md');
  expect(afterRemoval.workspaceInstructions).toContain('Instructions removed: "docs/AGENTS.md"');

  await writeFile(nestedFile, 'FIXTURE_REDISCOVERED_RULE');
  const [, rediscovered] = await harness.turn(session.id, 'docs/notes.txt');
  expect(rediscovered.workspaceInstructions).toContain('FIXTURE_REDISCOVERED_RULE');
});

test('removes nested instructions when their folder becomes a link outside the workspace', async (context) => {
  const { harness, session } = await setupNestedInstructions(context);
  await writeFile(join(harness.other, 'AGENTS.md'), 'FIXTURE_OTHER_RULE');
  await harness.turn(session.id, 'docs/notes.txt');
  await rename(join(harness.project, 'docs'), join(harness.project, 'original-docs'));
  await linkDirectory(harness.other, join(harness.project, 'docs'));
  const [, afterFolderReplacement] = await harness.turn(session.id, 'README.md');
  expect(afterFolderReplacement.workspaceInstructions).not.toContain('FIXTURE_OTHER_RULE');
  const allRecords = await trajectoryRecords(harness, session.id);
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
  const session = await startSession(harness);
  const [first, second] = await harness.turn(session.id, 'Host/notes.txt');
  expect(first.workspaceInstructions).toContain('FIXTURE_GLOBAL_RULE');
  expect(first.workspaceInstructions).not.toContain('FIXTURE_LOCAL_RULE');
  expect(second.workspaceInstructions).toMatch(/FIXTURE_GLOBAL_RULE[\s\S]*FIXTURE_LOCAL_RULE/);

  const records = await trajectoryRecords(harness, session.id);
  expect(
    records.filter((record) => record.kind === 'context').flatMap((record) => record.changes),
  ).toEqual([
    { action: 'add', path: 'Host AGENTS.md' },
    { action: 'add', path: 'Host/AGENTS.md' },
  ]);
});

test('discovers nested instructions after a successful write', async (context) => {
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
});

test('trims updated instructions to the UTF-8 budget and reuses the bounded context on access', async (context) => {
  const { harness, nestedFile, session } = await setupNestedInstructions(context);
  await writeFile(join(harness.project, 'AGENTS.md'), 'FIXTURE_PROJECT');
  await harness.turn(session.id, 'docs/notes.txt');
  await writeFile(nestedFile, '가'.repeat(24_000) + 'FIXTURE_BEYOND_LIMIT');
  const [, bounded] = await harness.turn(session.id, 'README.md');
  expect(bounded.workspaceInstructions).toContain('docs/AGENTS.md" (truncated)');
  expect(bounded.workspaceInstructions).toContain('omitted due to the size limit');
  expect(bounded.workspaceInstructions).not.toMatch(/FIXTURE_BEYOND_LIMIT|�/);
  const records = await trajectoryRecords(harness, session.id);
  const update = records.findLast((record) => record.kind === 'context');
  assert(update?.body);
  expect(update.body).toContain('가');
  expect(Buffer.byteLength(update.body)).toBeLessThanOrEqual(64 * 1024);
  await harness.turn(session.id, 'docs/notes.txt');
  const repeated = await trajectoryRecords(harness, session.id);
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
