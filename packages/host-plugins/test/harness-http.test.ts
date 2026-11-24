import {
  type RunSettings,
  conversationCatalogSchema,
  providerSettingsSchema,
  sessionSummarySchema,
} from '@workspace/protocol/host';
import { expect, test } from 'vitest';
import { origin, setupHarness } from './fixtures/harness.js';

test('requires authentication before accessing conversations or agent presets', async (context) => {
  const { fetch, post } = await setupHarness(context);
  expect((await post('/api/conversations', {})).status).toBe(401);
  expect((await fetch(origin + '/api/agent-presets')).status).toBe(401);
  expect((await post('/api/agent-presets', {})).status).toBe(401);
});

test('starts with no default model configured', async (context) => {
  const { fetch, login } = await setupHarness(context);
  await login();
  const emptyModels = providerSettingsSchema.parse(
    await (await fetch(origin + '/api/providers')).json(),
  );
  expect(emptyModels.defaultModel).toBe(null);
});

test('persists the selected model and effort for a conversation', async (context) => {
  const { prepareWorkspace, createPreset, fetch, post, turn, restart } =
    await setupHarness(context);
  const workspace = await prepareWorkspace();
  const preset = await createPreset();
  const initialRunSettings = { model: 'test-read/fixture', effort: 'high' };
  const response = await post('/api/conversations', {
    workspaceId: workspace.id,
    agentPresetId: preset.id,
    runSettings: initialRunSettings,
  });
  expect(response.status).toBe(201);
  const plain = sessionSummarySchema.parse(await response.json());
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

  expect((await changeSettings({ model: 'test-read/alternate', effort: 'high' })).status).toBe(400);

  const nextRunSettings: RunSettings = { model: 'test-read/alternate', effort: 'low' };
  expect((await changeSettings(nextRunSettings)).status).toBe(200);
  const changedRun = (await turn(plain.id, 'hello again'))[0];
  expect(changedRun.model).toBe('alternate');
  expect(changedRun.effort).toBe('low');
  await restart();
  const reopened = conversationCatalogSchema.parse(
    await (await fetch(origin + '/api/conversations')).json(),
  );
  expect(reopened.sessions.find(({ id }) => id === plain.id)?.runSettings).toEqual(nextRunSettings);
});
