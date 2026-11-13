import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { createFlueClient } from '@flue/sdk';
import {
  type AccessMode,
  type ModelOption,
  agentPresetSchema,
  sessionSummarySchema,
  workspaceSchema,
} from '@workspace/protocol/host';
import { type Runtime, createRuntime } from '@workspace/runtime';
import { type TestContext, expect } from 'vitest';
import type { AgentCapabilityPlugin } from '../../src/agent-capabilities/host.js';
import { fileReadCapability } from '../../src/agent-capabilities/file/read/host.js';
import { fileSearchCapability } from '../../src/agent-capabilities/file/search/host.js';
import { fileWriteCapability } from '../../src/agent-capabilities/file/write/host.js';
import { shellExecCapability } from '../../src/agent-capabilities/shell/host.js';
import { createAccessCodeVerifier } from '../../src/auth/access-code.js';
import { createAccessCodeAuth } from '../../src/auth/host.js';
import { createHarnessHost } from '../../src/harness/host.js';
import { createTrajectoryHost } from '../../src/trajectory/host.js';
import { workspaceFileAccessPolicy } from '../../src/workspace/file-mutations/host.js';
import { createWorkspaceHost } from '../../src/workspace/host.js';
import { type ModelRequest, fixtureProvider } from './model-provider.js';

export const origin = 'https://beluga.example';
const accessCode = 'fixture-only-access-code';

export async function setupHarness(
  { onTestFinished }: TestContext,
  initial = [fileReadCapability],
  beforeToolCall?: Parameters<typeof fixtureProvider>[1],
  makeProvider = fixtureProvider,
) {
  const temp = await mkdtemp(join(tmpdir(), 'beluga-read-'));
  let runtime: Runtime | undefined;
  onTestFinished(async () => {
    try {
      await runtime?.dispose();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
  const root = await realpath(temp);
  const project = join(root, 'project');
  const other = join(root, 'other');
  const observed: ModelRequest[] = [];

  await mkdir(join(project, 'docs'), { recursive: true });
  await mkdir(other);
  await writeFile(join(project, 'README.md'), 'project README\nsecond line\nthird line\n');
  await writeFile(join(project, 'docs', 'notes.txt'), 'other in-project file');
  await writeFile(join(project, 'unicode.txt'), ('\uD55C'.repeat(100) + '\n').repeat(200));
  await writeFile(join(project, 'long.txt'), 'line\n'.repeat(2_001));
  await writeFile(join(project, 'large.txt'), 'a'.repeat(1_048_577));

  const outside = join(other, 'README.md');
  await writeFile(outside, 'outside marker');
  await symlink(other, join(project, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  if (process.platform !== 'win32') {
    await symlink(outside, join(project, 'symlink.txt'));
  }
  await link(outside, join(project, 'hardlink.txt'));

  const databasePath = join(root, 'chat.sqlite');
  const verifier = await createAccessCodeVerifier(accessCode);
  const models: ModelOption[] = [
    { id: 'test-read/fixture', name: 'Fixture', providerName: 'Fixture', efforts: ['low', 'high'] },
    { id: 'test-read/alternate', name: 'Alternate', providerName: 'Fixture', efforts: ['low'] },
  ];

  const boot = (capabilities: AgentCapabilityPlugin[] = [fileReadCapability]) =>
    createRuntime([
      createTrajectoryHost(`${databasePath}.trajectory`),
      createHarnessHost(
        {
          origin,
          openProviders(register) {
            const provider = makeProvider(observed, beforeToolCall);
            register(provider);
            return {
              contextWindow: (_, id) =>
                provider.getModels().find((model) => model.id === id)?.contextWindow,
              list: () =>
                Promise.resolve([
                  {
                    id: 'test-read',
                    name: 'Fixture',
                    kind: 'openai-compatible',
                    status: 'connected',
                    models,
                  },
                ]),
              connect: () => Promise.reject(new Error('Unexpected fixture provider connection')),
              setCodexConnected: () =>
                Promise.reject(new Error('Unexpected fixture Codex connection')),
              disconnect: () =>
                Promise.reject(new Error('Unexpected fixture provider disconnection')),
              close() {},
            };
          },
          databasePath,
        },
        capabilities.map(({ service }) => service),
      ),
      ...capabilities.map(({ plugin }) => plugin),
      workspaceFileAccessPolicy,
      createWorkspaceHost(`${databasePath}.catalog`),
      createAccessCodeAuth({
        origin,
        databasePath: join(root, 'auth.sqlite'),
        loadVerifier: () => Promise.resolve(verifier),
      }),
    ]);

  let cookie = '';

  async function fetch(input: RequestInfo | URL, init?: RequestInit) {
    const runtime = getRuntime();
    const request = new Request(input, init);
    request.headers.set('origin', origin);
    if (cookie) {
      request.headers.set('cookie', cookie);
    }
    const route = new URL(request.url).pathname;
    const authHttp = runtime.get('auth').http;
    assert(authHttp);

    if (route.startsWith('/api/auth/')) {
      return authHttp.fetch(request);
    }
    if (route === '/api/workspaces') {
      return runtime.get('workspaceHttp').fetch(request);
    }

    return runtime.get('conversationHttp').fetch(request);
  }

  const post = (path: string, data: unknown) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });

  async function login() {
    const response = await post('/api/auth/login', { code: accessCode });
    expect(response.status).toBe(204);
    const header = response.headers.get('set-cookie');
    assert(header);
    cookie = header.split(';')[0];
  }

  async function createPreset(capabilities: string[] = []) {
    const response = await post('/api/agent-presets', {
      name: 'Test assistant',
      description: '',
      instructions: 'Help with the test request using the available tools.',
      capabilities,
    });
    expect(response.status).toBe(201);
    return agentPresetSchema.parse(await response.json());
  }

  async function create(workspaceId: string, agentPresetId?: string, accessMode?: AccessMode) {
    const response = await post('/api/conversations', {
      workspaceId,
      agentPresetId,
      accessMode,
    });
    expect(response.status).toBe(201);
    return sessionSummarySchema.parse(await response.json());
  }

  const sdk = (id: string) => createFlueClient({ url: `${origin}/api/conversations/${id}`, fetch });

  async function turn(
    id: string,
    path: string,
    initialData?: { sessionId: string },
    lineRange?: { offset?: number; limit?: number },
  ) {
    const client = sdk(id);
    const before = observed.length;
    const receipt = await client.send({
      message: { kind: 'user', body: JSON.stringify({ path, ...lineRange }) },
      initialData,
      idempotencyKey: crypto.randomUUID(),
    });
    await client.wait(receipt, { signal: AbortSignal.timeout(5_000) });
    return observed.slice(before);
  }

  function getRuntime() {
    assert(runtime, 'Fixture Host is not running');
    return runtime;
  }

  async function restart(capabilities = initial) {
    await runtime?.dispose();
    runtime = await boot(capabilities);
  }

  async function registerWorkspace(path: string) {
    const response = await post('/api/workspaces', { path });
    expect(response.status).toBe(201);
    return workspaceSchema.parse(await response.json());
  }

  async function prepareWorkspace() {
    await login();
    const response = await fetch(origin + '/api/providers/default-model', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test-read/fixture' }),
    });
    expect(response.status).toBe(200);
    return registerWorkspace(project);
  }

  await restart();
  return {
    project,
    other,
    outside,
    observed,
    databasePath,
    models,
    boot,
    restart,
    getRuntime,
    fetch,
    post,
    login,
    createPreset,
    create,
    sdk,
    turn,
    registerWorkspace,
    prepareWorkspace,
  };
}

export const resultText = (result: ToolResultMessage) =>
  result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');

export const allCapabilities = [
  fileReadCapability,
  fileSearchCapability,
  fileWriteCapability,
  shellExecCapability,
];
