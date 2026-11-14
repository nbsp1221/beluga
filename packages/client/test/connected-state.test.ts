import type { ConversationUsage, SessionSummary } from '@workspace/protocol/host';
import { expect, test, vi } from 'vitest';
import type { HostRequest } from '../src/transport/host-http.js';
import { createConnectedAgentPresets } from '../src/features/agent-presets/data/connected.js';
import { createConnectedConversation } from '../src/features/conversation/data/connected.js';
import { createConnectedModelProviders } from '../src/features/model-providers/data/connected.js';
import { createConnectedTrajectory } from '../src/features/trajectory/data/connected.js';
import { createConnectedWorkspaces } from '../src/features/workspaces/data/connected.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test('a provider refresh cannot restore a disconnected model', async () => {
  const stale = deferred<unknown>();
  const model = { id: 'a/model', name: 'Model', providerName: 'A', efforts: [] };

  const request: HostRequest = (_path, _body, method) =>
    method === 'DELETE' ? Promise.resolve({ providers: [], defaultModel: null }) : stale.promise;

  const providers = createConnectedModelProviders(request, {
    models: [model],
    defaultModel: model.id,
  });
  const refresh = providers.refresh();

  await providers.disconnectProvider('a');
  stale.resolve({
    providers: [
      { id: 'a', name: 'A', kind: 'openai-compatible', status: 'connected', models: [model] },
    ],
    defaultModel: model.id,
  });
  await refresh;

  expect(providers.getSnapshot()).toEqual({
    models: [],
    defaultModel: null,
    settings: { providers: [], defaultModel: null },
  });
});

test('an earlier response stays with the Trajectory page chain that requested it', async () => {
  const older = deferred<Response>();
  const refreshed = deferred<Response>();

  const page = (turn: number, before: number | null) =>
    Response.json({
      before,
      requests: [
        {
          turn,
          precedingModelRequests: 0,
          request: { id: `request-${turn}`, status: 'completed', records: [] },
        },
      ],
    });

  const fetchHost = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(page(51, 51))
    .mockImplementationOnce(() => refreshed.promise)
    .mockImplementationOnce(() => older.promise);
  const trajectory = createConnectedTrajectory(new AbortController().signal, fetchHost);
  const initial = trajectory.observe('session', '');
  await vi.waitFor(() => expect(trajectory.getSnapshot('session')?.before).toBe(51));
  initial();
  const stop = trajectory.observe('session', '');
  try {
    trajectory.loadEarlier('session');
    refreshed.resolve(page(101, 101));
    await vi.waitFor(() => expect(trajectory.getSnapshot('session')?.before).toBe(101));
    older.resolve(page(1, null));
    await vi.waitFor(() => expect(trajectory.getSnapshot('session')?.loadingEarlier).toBe(false));
    expect(trajectory.getSnapshot('session')?.before).toBe(101);
    expect(trajectory.getSnapshot('session')?.requests.map(({ turn }) => turn)).toEqual([101]);
  } finally {
    stop();
  }
});

test('changing one conversation model preserves another conversation’s pending usage', async () => {
  const updated = { model: 'provider/new', effort: 'default' } as const;
  const change = deferred<unknown>();
  const response = deferred<Response>();

  const request: HostRequest = () => change.promise;

  const makeSession = (id: string): SessionSummary => ({
    id,
    title: null,
    workspaceId: 'workspace',
    agentPresetId: 'preset',
    agentPresetName: 'Preset',
    agentPresetVersion: 1,
    agentPresetCapabilities: [],
    runSettings: { model: 'provider/old', effort: 'default' },
    accessMode: 'read-only',
  });

  const usage: ConversationUsage = {
    turns: 1,
    steps: 1,
    modelMs: null,
    toolMs: null,
    averageFirstOutputMs: null,
    outputTokensPerSecond: null,
    tokens: 12,
    input: 10,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
  };
  const client = createConnectedConversation({
    signal: new AbortController().signal,
    request,
    fetchHost: () => response.promise,
    sessions: [makeSession('first'), makeSession('second')],
    workspaces: createConnectedWorkspaces(request, []),
    agentPresets: createConnectedAgentPresets(request, {
      presets: [],
      capabilities: [],
      defaultPresetId: null,
    }),
    modelProviders: createConnectedModelProviders(request, { models: [], defaultModel: null }),
  });

  const changing = client.setRunSettings?.('first', updated);
  const stop = client.observeUsage?.('second');
  try {
    change.resolve(updated);
    await changing;
    response.resolve(Response.json(usage));
    await vi.waitFor(() => {
      const second = client.getSnapshot().sessions.find(({ id }) => id === 'second');
      expect(second?.usage?.tokens).toBe(12);
    });
  } finally {
    stop?.();
  }
});
