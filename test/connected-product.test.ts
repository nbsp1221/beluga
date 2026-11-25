import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { visitSite } from '@workspace/client/auth';
import {
  createAccessCodeAuth,
  issueAccessCode,
  readAccessCodeVerifier,
} from '@workspace/host-plugins/auth/host';
import { type TestContext, expect, test, vi } from 'vitest';
import { createProduct } from '../apps/web/src/product.ts';
import { fixtureProvider } from '../packages/host-plugins/test/fixtures/model-provider.js';
import { createHost } from '../packages/host-server/src/app.js';
import { createWeb } from '../packages/host-server/src/web.js';

const message = '{"path":"README.md"}';

const origins = [
  { origin: 'https://beluga.example', secure: true },
  { origin: 'http://192.0.2.10:8917', secure: false },
];

async function readCompletedTurn(
  product: Awaited<ReturnType<typeof createProduct>>,
  sessionId: string,
) {
  const trajectory = product.get('trajectoryClient');
  const stop = trajectory.observe(sessionId, '');
  try {
    return await vi.waitFor(
      () => {
        const turn = trajectory.getSnapshot(sessionId)?.requests.at(0)?.request;
        assert(turn?.status === 'completed');
        return turn;
      },
      { timeout: 5_000 },
    );
  } finally {
    stop();
  }
}

async function setupConnectedProduct(
  { onTestFinished }: TestContext,
  { origin, secure } = origins[0],
  holdTool?: () => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'beluga-connected-'));
  let host: Awaited<ReturnType<typeof createHost>> | undefined;
  const products = new Set<Awaited<ReturnType<typeof createProduct>>>();
  const hostRequests = new Set<Promise<Response>>();
  onTestFinished(async () => {
    try {
      for (const product of products) {
        await product.dispose();
      }
    } finally {
      try {
        await stopHost();
      } finally {
        vi.unstubAllGlobals();
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  const credential = join(directory, 'access-code.json');
  const code = await issueAccessCode(credential, false);
  const website = join(directory, 'web');
  const workspace = join(directory, 'project');

  await Promise.all([mkdir(website), mkdir(workspace)]);
  await Promise.all([
    writeFile(
      join(website, 'index.html'),
      '<html><head></head><body><div id="root"></div></body></html>',
    ),
    writeFile(join(workspace, 'README.md'), 'Connected fixture workspace'),
  ]);

  const web = await createWeb(website);
  const databasePath = join(directory, 'chat.sqlite');

  const boot = () =>
    createHost({
      auth: createAccessCodeAuth({
        origin,
        databasePath: join(directory, 'auth.sqlite'),
        loadVerifier: () => readAccessCodeVerifier(credential),
      }),
      harness: {
        origin,
        databasePath,
        instructionsDirectory: directory,
        openProviders(register) {
          register(fixtureProvider([], holdTool));
          return {
            list() {
              return Promise.resolve([
                {
                  id: 'test-read',
                  name: 'Fixture',
                  kind: 'openai-compatible',
                  status: 'connected',
                  models: [
                    {
                      id: 'test-read/fixture',
                      name: 'Fixture',
                      providerName: 'Fixture',
                      efforts: ['low', 'high'],
                    },
                  ],
                },
              ]);
            },
            connect: () => Promise.reject(new Error('Unexpected provider connection')),
            disconnect: () => Promise.reject(new Error('Unexpected provider disconnection')),
            contextWindow: () => 32_000,
            setCodexConnected: () => Promise.reject(new Error('Unexpected Codex connection')),
            close() {},
          };
        },
      },
      web,
    });

  host = await boot();

  let cookie: string | undefined;
  let activityUnavailable = false;
  const requests: string[] = [];
  const admissions: { receipt: unknown; location: string | null }[] = [];

  const fetchHost: typeof fetch = async (input, init) => {
    const request = new Request(typeof input === 'string' ? new URL(input, origin) : input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, origin);
    requests.push(url.pathname);
    if (activityUnavailable && url.pathname === '/api/conversations/activity') {
      activityUnavailable = false;
      return new Response(null, { status: 502 });
    }
    if (!host) {
      return new Response(null, { status: 502 });
    }
    request.headers.set('origin', origin);
    if (cookie) {
      request.headers.set('cookie', cookie);
    }
    if (secure) {
      // TLS ends at the proxy. The Host receives the same path over HTTP.
      url.protocol = 'http:';
      url.host = '127.0.0.1:8917';
    }
    const pending = host.fetch(new Request(url, request));
    hostRequests.add(pending);
    const response = await pending.finally(() => hostRequests.delete(pending));
    if (response.status === 202) {
      admissions.push({
        receipt: await response.clone().json(),
        location: response.headers.get('location'),
      });
    }
    return response;
  };

  const sendJson = (path: string, body: object, method = 'POST') =>
    fetchHost(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const sessionId = crypto.randomUUID();
  const pathname = '/chat/' + sessionId;
  const search = '?view=trajectory';
  const loginPath = '/login?next=' + encodeURIComponent(pathname + search);
  const replace = vi.fn();
  const storage = new Map<string, string>();
  vi.stubGlobal('window', { location: { origin, pathname, search, replace } });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('fetch', fetchHost);

  async function login() {
    const response = await sendJson('/api/auth/login', { code });
    expect(response.status).toBe(204);
    const issuedCookie = response.headers.get('set-cookie');
    assert(issuedCookie);
    cookie = issuedCookie.split(';')[0];
    assert(cookie);
    return issuedCookie;
  }

  async function openProduct() {
    const product = await createProduct(true);
    products.add(product);
    return product;
  }

  async function closeProduct(product: Awaited<ReturnType<typeof createProduct>>) {
    await product.dispose();
    products.delete(product);
  }

  async function stopHost() {
    const stopped = host;
    host = undefined;
    // Let admitted fetches finish before closing the fixture database.
    await Promise.allSettled(hostRequests);
    await stopped?.dispose();
  }

  async function restartHost() {
    await stopHost();
    host = await boot();
  }

  async function selectModel() {
    expect(
      (await sendJson('/api/providers/default-model', { model: 'test-read/fixture' }, 'PUT'))
        .status,
    ).toBe(200);
  }

  return {
    origin,
    boot,
    databasePath,
    workspace,
    fetchHost,
    sendJson,
    sessionId,
    pathname,
    search,
    loginPath,
    replace,
    requests,
    admissions,
    login,
    openProduct,
    closeProduct,
    selectModel,
    restartHost,
    async interruptActivity() {
      activityUnavailable = true;
      await stopHost();
    },
  };
}

test('rejects a second Host before it can recover live Trajectory records', async (context) => {
  const { boot, databasePath } = await setupConnectedProduct(context);
  using trajectoryDb = new DatabaseSync(`${databasePath}.trajectory`);
  trajectoryDb.exec(`
    INSERT INTO trajectory_turn (session_id, submission_id, status)
      VALUES ('active-session', 'active-submit', 'in-progress');
    INSERT INTO trajectory_record (session_id, submission_id, record_id, value)
      VALUES ('active-session', 'active-submit', 'compact',
        '{"kind":"compaction","status":"in-progress"}');
  `);
  await expect(boot().then((second) => second.dispose())).rejects.toThrow(
    'already active in this process',
  );
  expect(
    trajectoryDb
      .prepare("SELECT json_extract(value, '$.status') AS status FROM trajectory_record")
      .get(),
  ).toEqual({ status: 'in-progress' });
});

test.for(origins)(
  'authenticates and protects conversation routes at $origin',
  async (connection, context) => {
    const fixture = await setupConnectedProduct(context, connection);
    const { fetchHost, pathname, search, sessionId, loginPath, replace } = fixture;
    const { secure } = connection;
    const redirect = await fetchHost(pathname + search);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe(loginPath);
    expect(await (await fetchHost(loginPath)).text()).toContain(
      'name="beluga-mode" content="connected"',
    );
    expect((await fetchHost('/api/conversations')).status).toBe(401);
    expect((await fetchHost('/api/conversations/activity')).status).toBe(401);
    const unsavedConversation = `/api/conversations/${sessionId}`;
    for (const suffix of ['/trajectory', '/trajectory/submission/model', '/usage']) {
      const response = await fetchHost(unsavedConversation + suffix);
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(await visitSite()).toBe(false);
    expect(replace).toHaveBeenCalledExactlyOnceWith(loginPath);
    const issuedCookie = await fixture.login();
    expect(/;\s*Secure(?:;|$)/i.test(issuedCookie)).toBe(secure);
    expect((await fetchHost(pathname + search)).status).toBe(200);
    expect(await visitSite()).toBe(true);
    for (const suffix of ['/trajectory', '/trajectory/submission/model', '/usage']) {
      const response = await fetchHost(unsavedConversation + suffix);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Unknown session' });
    }
  },
);

test.for(origins)(
  'loads the connected catalog and registers the product views at $origin',
  async (connection, context) => {
    const fixture = await setupConnectedProduct(context, connection);
    await fixture.login();
    await fixture.selectModel();
    fixture.requests.length = 0;
    const product = await fixture.openProduct();
    expect(fixture.requests.toSorted()).toEqual(['/api/agent-presets', '/api/conversations']);
    expect(
      product
        .get('conversationViews')
        .getSnapshot()
        .map(({ id }) => id),
    ).toEqual(['chat', 'trajectory']);
    expect(
      product
        .get('destinations')
        .getSettings()
        .map(({ id }) => id),
    ).toEqual(['providers', 'built-in-tools', 'agent-presets', 'workspaces']);
  },
);

test.for(origins)(
  'submits and restores a recorded model request at $origin',
  { timeout: 20_000 },
  async (connection, context) => {
    const fixture = await setupConnectedProduct(context, connection);
    const { origin, admissions, workspace, fetchHost, search } = fixture;
    await fixture.login();
    await fixture.selectModel();
    const product = await fixture.openProduct();
    const workspaceId = await product.get('workspaces').addWorkspace(workspace);
    const conversation = product.get('conversation');
    expect(conversation.mode).toBe('connected');
    const draftId = await conversation.createSession(workspaceId);
    const { defaultPresetId } = product.get('agentPresets').getSnapshot();
    expect(defaultPresetId).toBeTruthy();
    expect(
      conversation.getSnapshot().sessions.find(({ id }) => id === draftId)?.agentPresetId,
    ).toBe(defaultPresetId);
    conversation.setDraft(draftId, message);
    await conversation.send(draftId, { mode: 'standard', attachments: [] });
    const streamUrl = `${origin}/api/conversations/${draftId}`;
    expect(admissions).toHaveLength(1);
    expect(admissions[0]?.receipt).toMatchObject({ streamUrl });
    expect(admissions[0]?.location).toBe(streamUrl);
    const trajectory = product.get('trajectoryClient');
    const recorded = await readCompletedTurn(product, draftId);

    const model = recorded.records.find(({ kind }) => kind === 'assistant');
    const tool = recorded.records.find(({ kind }) => kind === 'tool');
    assert(model?.kind === 'assistant');
    expect(tool).toMatchObject({ name: 'read', status: 'completed' });
    const input = await trajectory.loadModelInput(
      draftId,
      recorded.id,
      model.id,
      AbortSignal.timeout(5_000),
    );
    expect(input.tools.some(({ name }) => name === 'read')).toBe(true);

    const conversationPath = `/api/conversations/${draftId}`;
    const missingInput = await fetchHost(`${conversationPath}/trajectory/${recorded.id}/missing`);
    expect(missingInput.status).toBe(404);
    expect(await missingInput.json()).toEqual({ error: 'Model input unavailable' });
    const usage = await fetchHost(`${conversationPath}/usage`);
    expect(usage.status).toBe(200);
    expect(await usage.json()).toMatchObject({ turns: 1 });

    await fixture.closeProduct(product);
    await fixture.restartHost();
    expect((await fetchHost('/chat/' + draftId + search)).status).toBe(200);
    const reopenedProduct = await fixture.openProduct();
    const reopened = reopenedProduct.get('trajectoryClient');
    const stopReopened = reopened.observe(draftId, '');
    await vi
      .waitFor(
        () => {
          expect(reopened.getSnapshot(draftId)?.requests.map(({ request }) => request)).toEqual([
            recorded,
          ]);
        },
        { timeout: 5_000 },
      )
      .finally(stopReopened);
    expect(
      await reopened.loadModelInput(draftId, recorded.id, model.id, AbortSignal.timeout(5_000)),
    ).toEqual(input);
  },
);

test.for(origins)(
  'syncs activity across clients and restores unread work after a disconnect at $origin',
  { timeout: 20_000 },
  async (connection, context) => {
    let finishTool!: () => void;
    const toolGate = new Promise<void>((resolve) => {
      finishTool = resolve;
    });
    const fixture = await setupConnectedProduct(context, connection, () => toolGate);
    const { workspace, requests, sendJson } = fixture;
    await fixture.login();
    await fixture.selectModel();
    const product = await fixture.openProduct();
    const peer = await fixture.openProduct();
    const peerConversation = peer.get('conversation');
    const peerActivity = peerConversation.activity;
    const peerDraft = peerConversation.initialSessionId;
    assert(peerActivity && peerDraft);
    peerConversation.setDraft(peerDraft, 'Keep this unsent draft');
    const stopPeerActivity = peerActivity.observe();
    context.onTestFinished(stopPeerActivity);

    const workspaceId = await product.get('workspaces').addWorkspace(workspace);
    const conversation = product.get('conversation');
    expect(conversation.mode).toBe('connected');
    const activity = conversation.activity;
    assert(activity);
    const stopActivity = activity.observe();
    context.onTestFinished(stopActivity);

    const draftId = await conversation.createSession(workspaceId);
    conversation.setDraft(draftId, message);
    const send = conversation.send(draftId, { mode: 'standard', attachments: [] });
    try {
      await vi.waitFor(
        () => {
          expect(activity.getSnapshot()[draftId]?.running).toBe(true);
          expect(peerActivity.getSnapshot()[draftId]?.running).toBe(true);
          const remote = peerConversation.getSnapshot().sessions.find(({ id }) => id === draftId);
          expect(remote).toMatchObject({ id: draftId, workspaceId });
          expect(remote?.isDraft).toBeFalsy();
          expect(peer.get('workspaces').getSnapshot()).toContainEqual(
            expect.objectContaining({ id: workspaceId }),
          );
        },
        { timeout: 5_000 },
      );
    } finally {
      finishTool();
      await send;
    }

    const turn = await readCompletedTurn(product, draftId);
    assert(turn.settledAt);
    const recorded = turn.id;
    const completed = {
      running: false,
      lastActivityAt: turn.settledAt,
      unreadCompletion: recorded,
    };
    await vi.waitFor(() => expect(activity.getSnapshot()).toEqual({ [draftId]: completed }));
    await vi.waitFor(() => expect(peerActivity.getSnapshot()).toEqual({ [draftId]: completed }));
    const stopPeerChat = peerConversation.observeSession?.(draftId);
    try {
      await vi.waitFor(() => {
        const peerSessions = peerConversation.getSnapshot().sessions;
        expect(peerSessions.find(({ id }) => id === peerDraft)?.draft).toBe(
          'Keep this unsent draft',
        );
        const remote = peerSessions.find(({ id }) => id === draftId);
        expect(remote).toMatchObject({
          title: message,
          completedSubmissionId: recorded,
        });
        expect(remote?.messages.some(({ role }) => role === 'assistant')).toBe(true);
      });
    } finally {
      stopPeerChat?.();
      stopPeerActivity();
    }

    const activityRequests = () =>
      requests.filter((path) => path === '/api/conversations/activity');

    expect(activityRequests()).toHaveLength(2);
    await fixture.interruptActivity();
    await vi.waitFor(() => expect(activity.getSnapshot()).toEqual({}));
    await fixture.restartHost();
    await vi.waitFor(() => expect(activity.getSnapshot()).toEqual({ [draftId]: completed }), {
      timeout: 8_000,
    });
    expect(activityRequests()).toHaveLength(4);

    const readUrl = `/api/conversations/${draftId}/read`;
    expect((await sendJson(readUrl, { submissionId: 'older-turn' }, 'PUT')).status).toBe(204);
    expect(activity.getSnapshot()).toEqual({ [draftId]: completed });
    await activity.acknowledge(draftId, recorded);
    await vi.waitFor(() =>
      expect(activity.getSnapshot()).toEqual({
        [draftId]: { running: false, lastActivityAt: completed.lastActivityAt },
      }),
    );
    expect(activityRequests()).toHaveLength(4);
    stopActivity();
  },
);

test.for(origins)(
  'restores a conversation pinned to an earlier preset revision at $origin',
  async (connection, context) => {
    const fixture = await setupConnectedProduct(context, connection);
    const { workspace, sendJson } = fixture;
    await fixture.login();
    await fixture.selectModel();
    const product = await fixture.openProduct();
    const workspaceId = await product.get('workspaces').addWorkspace(workspace);
    const presets = product.get('agentPresets');
    const { presets: initialPresets, defaultPresetId } = presets.getSnapshot();
    expect(initialPresets).toHaveLength(1);
    const [standard] = initialPresets;
    expect(standard).toMatchObject({ name: 'Standard', id: defaultPresetId, version: 1 });
    const sessionId = crypto.randomUUID();
    const saved = await sendJson('/api/conversations', { id: sessionId, workspaceId });
    expect(saved.status).toBe(201);
    expect(await saved.json()).toMatchObject({ agentPresetId: standard.id, agentPresetVersion: 1 });
    const revised = await presets.save(
      {
        name: 'Edited standard',
        description: standard.description,
        instructions: 'Use the configured tools to inspect the workspace.',
        capabilities: standard.capabilities,
      },
      standard,
    );
    expect(revised).toMatchObject({ id: standard.id, version: 2 });
    await fixture.closeProduct(product);
    await fixture.restartHost();
    const reopened = await fixture.openProduct();
    expect(reopened.get('conversation').getSnapshot().sessions).toContainEqual(
      expect.objectContaining({
        id: sessionId,
        workspaceId,
        agentPresetId: standard.id,
        agentPresetVersion: 1,
        agentPresetName: 'Standard',
      }),
    );
    expect(reopened.get('agentPresets').getSnapshot().presets).toEqual([revised]);
  },
);

test.for(origins)(
  'uses the saved default preset for new conversations after restart at $origin',
  async (connection, context) => {
    const fixture = await setupConnectedProduct(context, connection);
    const { workspace, sendJson } = fixture;
    await fixture.login();
    await fixture.selectModel();
    const product = await fixture.openProduct();
    const workspaceId = await product.get('workspaces').addWorkspace(workspace);
    const presets = product.get('agentPresets');
    const [standard] = presets.getSnapshot().presets;
    const custom = await presets.save({
      name: 'Custom assistant',
      description: '',
      instructions: 'Answer using the supplied conversation.',
      capabilities: [],
    });
    expect(custom.version).toBe(1);
    expect(
      (await sendJson('/api/agent-presets/default', { presetId: custom.id }, 'PUT')).status,
    ).toBe(200);

    await fixture.closeProduct(product);
    await fixture.restartHost();
    const reopened = await fixture.openProduct();
    const reopenedCatalog = reopened.get('agentPresets').getSnapshot();
    expect(reopenedCatalog.presets).toHaveLength(2);
    expect(reopenedCatalog.presets).toEqual(expect.arrayContaining([standard, custom]));
    expect(reopenedCatalog.defaultPresetId).toBe(custom.id);
    const defaultConversation = await sendJson('/api/conversations', { workspaceId });
    expect(defaultConversation.status).toBe(201);
    expect(await defaultConversation.json()).toMatchObject({
      agentPresetId: custom.id,
      accessMode: 'read-only',
    });
  },
);

test.for(origins)(
  'remembers a cleared default preset after a restart at $origin',
  async (connection, context) => {
    const fixture = await setupConnectedProduct(context, connection);
    const { workspace, sendJson, fetchHost } = fixture;
    await fixture.login();
    await fixture.selectModel();
    const product = await fixture.openProduct();
    const workspaceId = await product.get('workspaces').addWorkspace(workspace);
    expect(product.get('agentPresets').getSnapshot().defaultPresetId).toBeTruthy();
    expect((await sendJson('/api/agent-presets/default', { presetId: null }, 'PUT')).status).toBe(
      200,
    );
    await fixture.closeProduct(product);
    await fixture.restartHost();
    const withoutDefault = await fetchHost('/api/agent-presets');
    expect(await withoutDefault.json()).toMatchObject({ defaultPresetId: null });
    expect((await sendJson('/api/conversations', { workspaceId })).status).toBe(409);
  },
);
