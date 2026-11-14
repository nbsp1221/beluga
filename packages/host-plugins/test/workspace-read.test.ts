import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, parse, relative, sep } from 'node:path';
import {
  type RunSettings,
  agentPresetSchema,
  agentPresetsSchema,
  conversationCatalogSchema,
  providerSettingsSchema,
  sessionSummarySchema,
  trajectoryModelInputResponseSchema,
  workspaceSchema,
} from '@workspace/protocol/host';
import { expect, test } from 'vitest';
import type { AgentCapability, AgentCapabilityPlugin } from '../src/agent-capabilities/host.js';
import { fileReadCapability } from '../src/agent-capabilities/file/read/host.js';
import type { ModelRequest } from './fixtures/model-provider.js';
import { origin, readTrajectory, resultText, setupHarness } from './fixtures/harness.js';

declare module '@workspace/runtime' {
  interface Services {
    duplicateRead: AgentCapability;
  }
}

function readToolResult(calls: ModelRequest[]) {
  expect([...calls[0].toolNames].sort()).toEqual(['read', 'task']);
  const result = calls.at(-1)?.result;
  assert(result);
  return result;
}

test(
  'rejects duplicate capability registrations before serving requests',
  { timeout: 30_000 },
  async (context) => {
    const { boot } = await setupHarness(context);
    const readService = fileReadCapability.service;
    const duplicate: AgentCapabilityPlugin = {
      service: 'duplicateRead',
      plugin: {
        id: 'test-duplicate-read',
        requires: [readService],
        provides: ['duplicateRead'],
        setup(context) {
          context.provide('duplicateRead', context.get(readService));
        },
      },
    };
    await expect(boot([fileReadCapability, duplicate])).rejects.toThrow(
      /Duplicate agent capability: file\.read/,
    );
  },
);

test(
  'authenticates Host calls and persists per-conversation model and effort',
  { timeout: 30_000 },
  async (context) => {
    const { project, models, fetch, post, login, turn, restart, createPreset } =
      await setupHarness(context);
    expect((await post('/api/conversations', {})).status).toBe(401);
    expect((await fetch(origin + '/api/agent-presets')).status).toBe(401);
    expect((await post('/api/agent-presets', {})).status).toBe(401);
    await login();
    const preset = await createPreset();
    const setDefaultPreset = await fetch(origin + '/api/agent-presets/default', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ presetId: preset.id }),
    });
    expect(setDefaultPreset.status).toBe(200);
    const capabilityCatalog = agentPresetsSchema.parse(
      await (await fetch(origin + '/api/agent-presets')).json(),
    );
    expect(
      capabilityCatalog.capabilities.map(({ id, access }) => ({
        id,
        access,
      })),
    ).toEqual([{ id: 'file.read', access: 'files' }]);
    const emptyModels = providerSettingsSchema.parse(
      await (await fetch(origin + '/api/providers')).json(),
    );
    expect(emptyModels.defaultModel).toBe(null);
    expect(
      (
        await fetch(origin + '/api/providers/default-model', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: models[0].id }),
        })
      ).status,
    ).toBe(200);
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
    const workspace = workspaceSchema.parse(
      await (await post('/api/workspaces', { path: project })).json(),
    );

    const initialRunSettings = { model: 'test-read/fixture', effort: 'high' };
    const plain = sessionSummarySchema.parse(
      await (
        await post('/api/conversations', {
          workspaceId: workspace.id,
          runSettings: initialRunSettings,
        })
      ).json(),
    );
    expect(plain.runSettings).toEqual(initialRunSettings);
    const initialRun = (await turn(plain.id, 'hello'))[0];
    expect(initialRun.model).toBe('fixture');
    expect(initialRun.effort).toBe('high');

    const runSettingsPath = `${origin}/api/conversations/${plain.id}/run-settings`;

    const changeSettings = (settings: RunSettings) =>
      fetch(runSettingsPath, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      });

    expect((await changeSettings({ model: 'test-read/alternate', effort: 'high' })).status).toBe(
      400,
    );

    const nextRunSettings: RunSettings = { model: 'test-read/alternate', effort: 'low' };
    expect((await changeSettings(nextRunSettings)).status).toBe(200);
    const changedRun = (await turn(plain.id, 'hello again'))[0];
    expect(changedRun.model).toBe('alternate');
    expect(changedRun.effort).toBe('low');
    await restart();
    const reopened = conversationCatalogSchema.parse(
      await (await fetch(origin + '/api/conversations')).json(),
    );
    expect(reopened.sessions.find(({ id }) => id === plain.id)?.runSettings).toEqual(
      nextRunSettings,
    );
  },
);

test(
  'opens workspace and explicit external files while rejecting forged session data',
  { timeout: 30_000 },
  async (context) => {
    const {
      project,
      other,
      outside,
      prepareWorkspace,
      registerWorkspace,
      post,
      create,
      createPreset,
      turn,
      fetch,
      restart,
    } = await setupHarness(context);
    await writeFile(join(project, 'AGENTS.md'), 'workspace instruction marker');
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
    expect(input.systemPrompt).not.toMatch(/Working directory:|workspace instruction marker/);

    const next = readToolResult(
      await turn(reading.id, 'README.md', undefined, { offset: 3, limit: 1 }),
    );
    expect(JSON.parse(resultText(next))).toContain('third line');

    const long = readToolResult(await turn(reading.id, 'long.txt'));
    expect(resultText(long)).toContain('Use offset=2001 to continue.');
    const unicode = readToolResult(await turn(reading.id, 'unicode.txt'));
    expect(unicode.isError).toBe(false);
    const unicodeText: unknown = JSON.parse(resultText(unicode));
    assert(typeof unicodeText === 'string');
    expect(Buffer.byteLength(unicodeText, 'utf8')).toBeLessThan(52_000);
    const smaller = readToolResult(
      await turn(reading.id, 'unicode.txt', undefined, { limit: 100 }),
    );
    expect(smaller.isError).toBe(false);
    expect(JSON.parse(resultText(smaller))).toContain('Use offset=101 to continue.');
    const large = readToolResult(await turn(reading.id, 'large.txt'));
    expect(large.isError).toBe(false);
    expect(JSON.parse(resultText(large))).toBe('[The requested line exceeds 50.0KB limit.]');

    const aliases = join(project, 'pi-path.txt');
    await writeFile(aliases, 'first\nsecond\nthird');
    const piRange = readToolResult(
      await turn(reading.id, '@pi-path.txt', undefined, { limit: -1 }),
    );
    const piRangeText: unknown = JSON.parse(resultText(piRange));
    expect(piRangeText).toContain('first\nsecond');
    expect(piRangeText).not.toContain('third');

    const notes = readToolResult(await turn(reading.id, 'docs/notes.txt'));
    expect(resultText(notes)).toMatch(/other in-project file/);

    const allowed = [
      '../other/README.md',
      outside.split(sep).join('/'),
      'alias/README.md',
      'hardlink.txt',
    ];
    if (process.platform !== 'win32') {
      allowed.push('symlink.txt');
    }
    for (const file of allowed) {
      const result = readToolResult(await turn(reading.id, file));
      assert.equal(result.isError, false, file);
      expect(resultText(result)).toMatch(/outside marker/);
    }
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

test(
  'preserves preset revisions and rejects execution when a capability is missing',
  { timeout: 30_000 },
  async (context) => {
    const { prepareWorkspace, fetch, post, create, createPreset, turn, restart, sdk } =
      await setupHarness(context);
    const workspace = await prepareWorkspace();
    const plainPreset = await createPreset();
    const readPreset = await createPreset(['file.read']);
    const plain = await create(workspace.id, plainPreset.id);
    const reading = await create(workspace.id, readPreset.id);
    readToolResult(await turn(reading.id, 'README.md'));
    const definition = {
      name: 'Third preset',
      description: 'Reads the project',
      instructions: 'PRESET_V1 Read project files.',
      capabilities: ['file.read'],
    };
    const presetsPath = '/api/agent-presets';
    expect((await post(presetsPath, { ...definition, capabilities: ['shell.exec'] })).status).toBe(
      400,
    );
    expect(
      (
        await post(presetsPath, {
          ...definition,
          capabilities: ['workspace.read'],
        })
      ).status,
    ).toBe(400);
    const created = await post(presetsPath, definition);
    expect(created.status).toBe(201);
    const preset = agentPresetSchema.parse(await created.json());
    expect(preset.capabilities).toEqual(['file.read']);
    const older = await create(workspace.id, preset.id);
    expect(older.agentPresetVersion).toBe(1);
    expect(older.agentPresetCapabilities).toEqual(['file.read']);
    const first = await turn(older.id, 'README.md');
    expect(first[0].instructions).toMatch(/PRESET_V1/);
    expect(resultText(readToolResult(first))).toMatch(/project README/);

    const update = (capabilities: string[] = []) =>
      fetch(origin + presetsPath + '/' + preset.id, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...definition,
          name: 'Third preset updated',
          version: 1,
          instructions: 'PRESET_V2 Chat without project files.',
          capabilities,
        }),
      });

    expect((await update(['workspace.read'])).status).toBe(400);
    expect((await update()).status).toBe(200);
    expect((await update()).status).toBe(409);
    const draft = {
      id: crypto.randomUUID(),
      workspaceId: workspace.id,
      agentPresetId: preset.id,
    };
    expect((await post('/api/conversations', { ...draft, agentPresetVersion: 1 })).status).toBe(
      409,
    );
    const current = sessionSummarySchema.parse(
      await (await post('/api/conversations', { ...draft, agentPresetVersion: 2 })).json(),
    );
    expect(current.id).toBe(draft.id);
    expect(current.agentPresetVersion).toBe(2);
    expect(current.agentPresetCapabilities).toEqual([]);
    expect(
      sessionSummarySchema.parse(
        await (await post('/api/conversations', { ...draft, agentPresetVersion: 2 })).json(),
      ),
    ).toEqual(current);
    const second = await turn(current.id, 'README.md');
    expect(second[0].instructions).toMatch(/PRESET_V2/);
    expect(second[0].toolNames).toEqual(['task']);

    await restart([]);
    expect(
      agentPresetsSchema.parse(await (await fetch(origin + presetsPath)).json()).capabilities,
    ).toEqual([]);
    expect((await turn(plain.id, 'README.md'))[0].toolNames).toEqual(['task']);
    expect((await fetch(`${origin}/api/conversations/${reading.id}?view=history`)).status).toBe(
      200,
    );
    expect(
      (
        await post(`/api/conversations/${reading.id}`, {
          kind: 'user',
          body: 'README.md',
        })
      ).status,
    ).toBe(503);

    await restart();
    expect(resultText(readToolResult(await turn(reading.id, 'README.md')))).toMatch(
      /project README/,
    );
    assert((await sdk(reading.id).history()).messages.length > 0);
    assert((await sdk(older.id).history()).messages.length > 0);
    const restored = await turn(older.id, 'README.md');
    expect(restored[0].instructions).toMatch(/PRESET_V1/);
    expect(resultText(readToolResult(restored))).toMatch(/project README/);
    expect(resultText(readToolResult(await turn(older.id, '../other/README.md')))).toContain(
      'outside marker',
    );
    const restoredCurrent = await turn(current.id, 'README.md');
    expect(restoredCurrent[0].instructions).toMatch(/PRESET_V2/);
    expect(restoredCurrent[0].toolNames).toEqual(['task']);
    const reopened = conversationCatalogSchema.parse(
      await (await fetch(origin + '/api/conversations')).json(),
    );
    expect(reopened.sessions.find(({ id }) => id === older.id)?.agentPresetCapabilities).toEqual([
      'file.read',
    ]);
    expect(
      agentPresetsSchema
        .parse(await (await fetch(origin + presetsPath)).json())
        .presets.find(({ id }) => id === preset.id)?.version,
    ).toBe(2);
  },
);
