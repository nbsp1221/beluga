import assert from 'node:assert/strict';
import {
  agentPresetSchema,
  agentPresetsSchema,
  conversationCatalogSchema,
  sessionSummarySchema,
} from '@workspace/protocol/host';
import { expect, test } from 'vitest';
import type { AgentCapability, AgentCapabilityPlugin } from '../src/agent-capabilities/host.js';
import { fileReadCapability } from '../src/agent-capabilities/file/read/host.js';
import { origin, readToolResult, resultText, setupHarness } from './fixtures/harness.js';

declare module '@workspace/runtime' {
  interface Services {
    duplicateRead: AgentCapability;
  }
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

test('lists the registered preset capabilities and their access levels', async (context) => {
  const { fetch, login } = await setupHarness(context);
  await login();
  const capabilityCatalog = agentPresetsSchema.parse(
    await (await fetch(origin + '/api/agent-presets')).json(),
  );
  expect(
    capabilityCatalog.capabilities.map(({ id, access }) => ({
      id,
      access,
    })),
  ).toEqual([
    { id: 'file.read', access: 'files' },
    { id: 'agent-instructions', access: undefined },
  ]);
});

test('records the chosen default preset', async (context) => {
  const { fetch, login, createPreset } = await setupHarness(context);
  await login();
  const preset = await createPreset();
  const setDefaultPreset = await fetch(origin + '/api/agent-presets/default', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ presetId: preset.id }),
  });
  expect(setDefaultPreset.status).toBe(200);
  const catalog = agentPresetsSchema.parse(
    await (await fetch(origin + '/api/agent-presets')).json(),
  );
  expect(catalog.defaultPresetId).toBe(preset.id);
});

test('returns a service error for a pinned capability while its plugin is unavailable', async (context) => {
  const { prepareWorkspace, fetch, post, create, createPreset, turn, restart, sdk } =
    await setupHarness(context);
  const workspace = await prepareWorkspace();
  const plainPreset = await createPreset();
  const readPreset = await createPreset(['file.read']);
  const plain = await create(workspace.id, plainPreset.id);
  const reading = await create(workspace.id, readPreset.id);
  readToolResult(await turn(reading.id, 'README.md'));
  const presetsPath = '/api/agent-presets';
  await restart([]);
  expect(
    agentPresetsSchema
      .parse(await (await fetch(origin + presetsPath)).json())
      .capabilities.map(({ id }) => id),
  ).toEqual(['agent-instructions']);
  expect((await turn(plain.id, 'README.md'))[0].toolNames).toEqual(['task']);
  expect((await fetch(`${origin}/api/conversations/${reading.id}?view=history`)).status).toBe(200);
  expect(
    (
      await post(`/api/conversations/${reading.id}`, {
        kind: 'user',
        body: 'README.md',
      })
    ).status,
  ).toBe(503);

  await restart();
  expect(resultText(readToolResult(await turn(reading.id, 'README.md')))).toMatch(/project README/);
  assert((await sdk(reading.id).history()).messages.length > 0);
});

test('keeps sessions pinned to their preset revision after edits and restart', async (context) => {
  const { prepareWorkspace, fetch, post, create, turn, restart, sdk } = await setupHarness(context);
  const workspace = await prepareWorkspace();
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
  expect((await post('/api/conversations', { ...draft, agentPresetVersion: 1 })).status).toBe(409);
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

  await restart();
  expect((await sdk(older.id).history()).messages.length).toBeGreaterThan(0);
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
});
