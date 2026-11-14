import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { createWorkspaceCatalog } from '../src/workspace/catalog.js';
import { browseFolders, resolveFolder } from '../src/workspace/folders.js';

const definition = {
  name: 'Test assistant',
  description: '',
  instructions: 'Help with the test request.',
  capabilities: [],
};

test('stores only pinned preset revisions and assigns the first title once', () => {
  using db = new DatabaseSync(':memory:');
  const catalog = createWorkspaceCatalog(db);
  const workspace = catalog.add(process.cwd()).workspace;
  const preset = catalog.presets.create(definition);
  const settings = { model: 'provider/model', effort: 'default' } as const;

  expect(catalog.presets.revise('missing', 1, definition)).toBeUndefined();
  expect(catalog.presets.revise(preset.id, 5, definition)).toBeUndefined();
  expect(catalog.presets.revise(preset.id, 1, definition)?.version).toBe(2);
  expect(catalog.presets.revise(preset.id, 1, definition)).toBeUndefined();
  expect(() =>
    catalog.createSession(workspace.id, { ...preset, version: 5 }, 'invalid', settings),
  ).toThrow();
  expect(catalog.list().sessions).toEqual([]);

  const session = catalog.createSession(workspace.id, preset, 'session', settings);
  expect(session.title).toBeNull();
  catalog.setFirstTitle(session.id, 'New session');
  catalog.setFirstTitle(session.id, 'Second message');
  expect(createWorkspaceCatalog(db).findSession(session.id)).toMatchObject({
    agentPresetVersion: 1,
    title: 'New session',
  });
});

test('keeps saved conversation settings when the default model changes', async ({
  onTestFinished,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'beluga-workspace-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));

  const catalogPath = join(root, 'chat.sqlite.catalog');
  const db = new DatabaseSync(catalogPath);
  try {
    const catalog = createWorkspaceCatalog(db);
    const workspace = catalog.add(root).workspace;
    const preset = catalog.presets.create(definition);
    const settings = { model: 'provider/selected', effort: 'default' } as const;
    const session = catalog.createSession(workspace.id, preset, crypto.randomUUID(), settings);

    catalog.saveDefaultModel('provider/new');

    const reopened = createWorkspaceCatalog(db);
    expect(reopened.defaultModel()).toBe('provider/new');
    expect(reopened.findSession(session.id)?.runSettings).toEqual(settings);
  } finally {
    db.close();
  }
});

test('registers canonical folders and rejects new sessions when a folder disappears', async ({
  onTestFinished,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'beluga-workspace-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));

  const db = new DatabaseSync(':memory:');
  try {
    const catalog = createWorkspaceCatalog(db);
    const first = join(root, 'first', 'Example');
    const second = join(root, 'second', 'Example');
    const alias = join(root, 'alias');
    const file = join(root, 'private.txt');
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await symlink(first, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(file, 'not part of the folder listing');

    expect((await browseFolders(root)).folders.map(({ name }) => name)).toEqual([
      'first',
      'second',
    ]);
    await assert.rejects(resolveFolder('relative'), { status: 400 });
    await assert.rejects(resolveFolder(file), { status: 400 });
    await assert.rejects(resolveFolder(join(root, 'missing')), { status: 404 });

    const entry = catalog.add(await resolveFolder(first)).workspace;
    const repeated = catalog.add(await resolveFolder(alias));
    expect(repeated.created).toBe(false);
    expect(repeated.workspace.id).toBe(entry.id);
    expect(catalog.add(await resolveFolder(second)).workspace.id).not.toBe(entry.id);

    const preset = catalog.presets.create(definition);
    const session = catalog.createSession(entry.id, preset, crypto.randomUUID(), {
      model: 'provider/model',
      effort: 'default',
    });
    expect(session.workspaceId).toBe(entry.id);
    expect(await catalog.canStartSession(entry)).toBe(true);

    await rename(first, `${first}-moved`);
    expect(await catalog.canStartSession(entry)).toBe(false);
    expect(catalog.findSession(session.id)?.agentPresetId).toBe(preset.id);
  } finally {
    db.close();
  }
});
