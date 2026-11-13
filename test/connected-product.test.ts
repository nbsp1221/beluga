import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { visitSite } from '@workspace/client/auth';
import {
  createAccessCodeAuth,
  issueAccessCode,
  readAccessCodeVerifier,
} from '@workspace/host-plugins/auth/host';
import { expect, test, vi } from 'vitest';
import { createHost } from '../apps/host/src/app.js';
import { createWeb } from '../apps/host/src/web.js';
import { createProduct } from '../apps/web/src/product.ts';
import { fixtureProvider } from '../packages/host-plugins/test/fixtures/model-provider.js';

const origin = 'https://beluga.example';
const message = '{"path":"README.md"}';

test(
  'authenticates a deep link and restores recorded activity through the connected product',
  {
    timeout: 20_000,
  },
  async ({ onTestFinished }) => {
    const directory = await mkdtemp(join(tmpdir(), 'beluga-connected-'));
    let host: Awaited<ReturnType<typeof createHost>> | undefined;
    let product: Awaited<ReturnType<typeof createProduct>> | undefined;
    onTestFinished(async () => {
      try {
        await product?.dispose();
      } finally {
        try {
          await host?.dispose();
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
          openProviders(register) {
            register(fixtureProvider([]));
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
    const requests: string[] = [];
    const admissions: { receipt: unknown; location: string | null }[] = [];

    const fetchHost: typeof fetch = async (input, init) => {
      assert(host);
      const request = new Request(typeof input === 'string' ? new URL(input, origin) : input, init);
      const url = new URL(request.url);
      assert.equal(url.origin, origin);
      requests.push(url.pathname);
      request.headers.set('origin', origin);
      if (cookie) {
        request.headers.set('cookie', cookie);
      }
      // TLS ends at the proxy. The Host receives the same path over HTTP.
      url.protocol = 'http:';
      url.host = '127.0.0.1:3001';
      const response = await host.fetch(new Request(url, request));
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

    const redirect = await fetchHost(pathname + search);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe(loginPath);
    expect(await (await fetchHost(loginPath)).text()).toContain(
      'name="beluga-mode" content="connected"',
    );
    expect((await fetchHost('/api/conversations')).status).toBe(401);
    const unsavedConversation = `/api/conversations/${sessionId}`;
    for (const suffix of ['/trajectory', '/trajectory/submission/model', '/usage']) {
      const response = await fetchHost(unsavedConversation + suffix);
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(await visitSite()).toBe(false);
    expect(replace).toHaveBeenCalledExactlyOnceWith(loginPath);

    const login = await sendJson('/api/auth/login', { code });
    expect(login.status).toBe(204);
    cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert(cookie);
    expect((await fetchHost(pathname + search)).status).toBe(200);
    expect(await visitSite()).toBe(true);
    for (const suffix of ['/trajectory', '/trajectory/submission/model', '/usage']) {
      const response = await fetchHost(unsavedConversation + suffix);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Unknown session' });
    }

    expect(
      (await sendJson('/api/providers/default-model', { model: 'test-read/fixture' }, 'PUT'))
        .status,
    ).toBe(200);

    requests.length = 0;
    product = await createProduct(true);
    expect(requests.toSorted()).toEqual(['/api/agent-presets', '/api/conversations']);
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

    const workspaceId = await product.get('workspaces').addWorkspace(workspace);
    const conversation = product.get('conversation');
    expect(conversation.mode).toBe('connected');
    const presets = product.get('agentPresets');
    const { presets: initialPresets, defaultPresetId } = presets.getSnapshot();
    expect(initialPresets).toHaveLength(1);
    const [standard] = initialPresets;
    expect(standard).toMatchObject({ name: 'Standard', id: defaultPresetId, version: 1 });
    const draftId = await conversation.createSession(workspaceId);
    expect(
      conversation.getSnapshot().sessions.find(({ id }) => id === draftId)?.agentPresetId,
    ).toBe(standard.id);
    conversation.setDraft(draftId, message);
    await conversation.send(draftId, { mode: 'standard', attachments: [] });
    const streamUrl = `${origin}/api/conversations/${draftId}`;
    expect(admissions).toHaveLength(1);
    expect(admissions[0]?.receipt).toMatchObject({ streamUrl });
    expect(admissions[0]?.location).toBe(streamUrl);

    const trajectory = product.get('trajectoryClient');
    const stop = trajectory.observe(draftId);
    const recorded = await vi
      .waitFor(
        () => {
          const snapshot = trajectory.getSnapshot(draftId);
          const turn = snapshot?.requests.at(0);
          assert(turn?.status === 'completed');
          return turn;
        },
        { timeout: 5_000 },
      )
      .finally(stop);

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

    await product.dispose();
    product = undefined;
    await host.dispose();
    host = await boot();

    expect((await fetchHost('/chat/' + draftId + search)).status).toBe(200);
    expect(await visitSite()).toBe(true);
    product = await createProduct(true);
    expect(product.get('conversation').getSnapshot().sessions).toContainEqual(
      expect.objectContaining({
        id: draftId,
        workspaceId,
        agentPresetId: standard.id,
        agentPresetVersion: 1,
        agentPresetName: 'Standard',
      }),
    );
    const reopenedCatalog = product.get('agentPresets').getSnapshot();
    expect(reopenedCatalog.presets).toHaveLength(2);
    expect(reopenedCatalog.presets).toEqual(expect.arrayContaining([revised, custom]));
    expect(reopenedCatalog.defaultPresetId).toBe(custom.id);
    const defaultConversation = await sendJson('/api/conversations', { workspaceId });
    expect(defaultConversation.status).toBe(201);
    expect(await defaultConversation.json()).toMatchObject({
      agentPresetId: custom.id,
      accessMode: 'read-only',
    });

    const reopened = product.get('trajectoryClient');
    const stopReopened = reopened.observe(draftId);
    await vi
      .waitFor(
        () => {
          expect(reopened.getSnapshot(draftId)?.requests).toEqual([recorded]);
        },
        { timeout: 5_000 },
      )
      .finally(stopReopened);
    expect(
      await reopened.loadModelInput(draftId, recorded.id, model.id, AbortSignal.timeout(5_000)),
    ).toEqual(input);

    expect((await sendJson('/api/agent-presets/default', { presetId: null }, 'PUT')).status).toBe(
      200,
    );
    await product.dispose();
    product = undefined;
    await host.dispose();
    host = await boot();
    const withoutDefault = await fetchHost('/api/agent-presets');
    expect(await withoutDefault.json()).toMatchObject({ defaultPresetId: null });
    expect((await sendJson('/api/conversations', { workspaceId })).status).toBe(409);
  },
);
