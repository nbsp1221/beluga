import assert from 'node:assert/strict';
import { once } from 'node:events';
import { link, readFile, writeFile } from 'node:fs/promises';
import { type Socket, createServer } from 'node:net';
import { join } from 'node:path';
import {
  type AccessMode,
  agentPresetSchema,
  trajectoryModelInputResponseSchema,
} from '@workspace/protocol/host';
import { type TestContext, expect, test, vi } from 'vitest';
import type { fixtureProvider } from './fixtures/model-provider.js';
import {
  allCapabilities,
  linkDirectory,
  origin,
  readTrajectory,
  resultText,
  setupHarness,
} from './fixtures/harness.js';

const windows = process.platform === 'win32';
const shell = windows ? 'pwsh' : 'bash';
const command = windows ? 'Write-Output PI_SHELL_OK' : 'printf "%s\\n" PI_SHELL_OK';

function latch() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, wait };
}

async function waitForStart<T>(
  started: Promise<T>,
  waitForCompletion: (signal: AbortSignal) => Promise<unknown>,
  phase: string,
) {
  const controller = new AbortController();

  async function failIfSettled(): Promise<never> {
    try {
      await waitForCompletion(controller.signal);
    } catch (cause) {
      throw new Error(`Submission failed before ${phase}.`, { cause });
    }
    throw new Error(`Submission completed before ${phase}.`);
  }

  try {
    return await Promise.race([started, failIfSettled()]);
  } finally {
    controller.abort();
  }
}

async function setupTools(
  context: TestContext,
  mode?: AccessMode,
  beforeToolCall?: Parameters<typeof fixtureProvider>[1],
) {
  const harness = await setupHarness(context, allCapabilities, beforeToolCall);
  const workspace = await harness.prepareWorkspace();
  const preset = agentPresetSchema.parse(
    await (
      await harness.post('/api/agent-presets', {
        description: 'Workspace tool fixture',
        instructions: 'Use project tools when asked.',
        name: 'Coding tools fixture',
        capabilities: ['file.read', 'file.search', 'file.write', 'shell.exec'],
      })
    ).json(),
  );
  const session = await harness.create(workspace.id, preset.id, mode);
  const client = harness.sdk(session.id);
  const trajectoryUrl = `${origin}/api/conversations/${session.id}/trajectory`;

  const send = (tool: string, args: Record<string, unknown>) =>
    client.send({
      message: { kind: 'user', body: JSON.stringify({ tool, ...args }) },
      idempotencyKey: crypto.randomUUID(),
    });

  async function execute(tool: string, args: Record<string, unknown>) {
    const before = harness.observed.length;
    const receipt = await send(tool, args);
    await client.wait(receipt, { signal: AbortSignal.timeout(15_000) });
    const request = harness.observed.slice(before).at(-1);
    assert(request, 'Expected a model call');
    return request;
  }

  async function setMode(mode: AccessMode) {
    const response = await harness.fetch(`${origin}/api/conversations/${session.id}/access-mode`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    expect(response.status).toBe(200);
  }

  const history = async () => await readTrajectory(harness.fetch(trajectoryUrl));

  return { ...harness, session, client, execute, send, setMode, history, trajectoryUrl };
}

test('records the glob result and schema seen by the model', async (context) => {
  const { execute, history, fetch, trajectoryUrl } = await setupTools(context);
  const globArgs = { pattern: '*.md', path: '../other' };
  const found = await execute('glob', globArgs);
  expect(found.toolNames.toSorted()).toEqual(['glob', 'grep', 'read', 'task']);
  assert(found.result);
  expect(found.result.isError, resultText(found.result)).toBe(false);
  expect(resultText(found.result)).toContain('README.md');
  const globRequest = (await history()).at(0);
  const globCall = globRequest?.records.find((record) => record.kind === 'tool');
  assert(globRequest && globCall?.kind === 'tool' && globCall.modelRequestId);
  const globInput = trajectoryModelInputResponseSchema.parse(
    await (await fetch(`${trajectoryUrl}/${globRequest.id}/${globCall.modelRequestId}`)).json(),
  );
  const globSchema = found.toolSchemas.get('glob');
  expect(globSchema).toMatchObject({ required: ['pattern'] });
  expect(globCall).toMatchObject({
    name: 'glob',
    status: 'completed',
    input: globArgs,
    schema: globSchema,
  });
  expect(JSON.stringify(globCall.output)).toContain('README.md');
  expect(globInput.tools.map(({ name }) => name).toSorted()).toEqual(found.toolNames.toSorted());
  expect(globInput.tools.find(({ name }) => name === 'glob')?.parameters).toEqual(globSchema);
});

test('records the grep result and schema seen by the model', async (context) => {
  const { execute, history, fetch, trajectoryUrl } = await setupTools(context);
  const args = { pattern: 'outside marker', path: '../other', glob: '*.md', literal: true };
  const searched = await execute('grep', args);
  assert(searched.result);
  expect(searched.result.isError, resultText(searched.result)).toBe(false);
  expect(resultText(searched.result)).toContain('README.md:1: outside marker');

  const request = (await history()).find(({ records }) =>
    records.some((record) => record.kind === 'tool' && record.name === 'grep'),
  );
  const tool = request?.records.find((record) => record.kind === 'tool');
  assert(request && tool?.kind === 'tool' && tool.modelRequestId);
  expect(tool).toMatchObject({ name: 'grep', status: 'completed', input: args });
  expect(JSON.stringify(tool.output)).toContain('outside marker');
  const input = trajectoryModelInputResponseSchema.parse(
    await (await fetch(`${trajectoryUrl}/${request.id}/${tool.modelRequestId}`)).json(),
  );
  const schema = searched.toolSchemas.get('grep');
  expect(schema).toMatchObject({
    properties: { glob: { type: 'string' } },
    required: ['pattern'],
  });
  expect(tool.schema).toEqual(schema);
  expect(input.tools.find(({ name }) => name === 'grep')?.parameters).toEqual(schema);
});

test('records invalid grep input as a failed tool call', async (context) => {
  const { execute, history } = await setupTools(context);
  const invalid = { path: '../other' };
  const rejected = await execute('grep', invalid);
  expect(rejected.result?.isError).toBe(true);
  const schema = rejected.toolSchemas.get('grep');
  expect(schema).toMatchObject({ required: ['pattern'] });
  expect((await history()).at(-1)?.records).toContainEqual(
    expect.objectContaining({ name: 'grep', status: 'failed', input: invalid, schema }),
  );
});

test('exposes mutation and shell tools according to the current access mode', async (context) => {
  const { execute, setMode } = await setupTools(context);
  const denied = await execute('write', { path: 'blocked.txt', content: 'blocked' });
  expect(denied.toolNames).not.toContain('write');
  expect(denied.result).toBeUndefined();
  await setMode('workspace-write');
  expect((await execute(shell, { command })).toolNames).not.toContain(shell);

  await setMode('full-access');
  expect((await execute('read', { path: 'README.md' })).toolNames).toContain(shell);
  await setMode('read-only');
  expect((await execute(shell, { command })).result).toBeUndefined();
  expect((await execute('edit', { path: 'README.md', edits: [] })).result).toBeUndefined();
});

test('creates, overwrites, and edits a workspace file while preserving its line endings', async (context) => {
  const { execute, project, history } = await setupTools(context, 'workspace-write');
  const path = 'new/note.txt';
  expect((await execute('write', { path, content: 'before' })).result?.isError).toBe(false);
  const writeArgs = { path, content: 'draft\r\nsecond\r\n' };
  const written = await execute('write', writeArgs);
  expect(written.result?.isError).toBe(false);
  const edits = [
    { oldText: 'draft', newText: 'ready' },
    { oldText: 'second', newText: 'third' },
  ];
  const editArgs = { path, edits };
  const edited = await execute('edit', editArgs);
  expect(edited.result?.isError).toBe(false);
  expect(await readFile(join(project, path), 'utf8')).toBe('ready\r\nthird\r\n');

  const mutationRecords = (await history())
    .flatMap(({ records }) => records)
    .filter((record) => record.kind === 'tool');
  const writeRecord = mutationRecords.findLast((record) => record.name === 'write');
  const editRecord = mutationRecords.findLast((record) => record.name === 'edit');
  expect(writeRecord).toMatchObject({
    status: 'completed',
    input: writeArgs,
    schema: written.toolSchemas.get('write'),
  });
  expect(JSON.stringify(writeRecord?.output)).toContain('Successfully wrote to');
  expect(editRecord).toMatchObject({
    status: 'completed',
    input: editArgs,
    schema: edited.toolSchemas.get('edit'),
  });
  expect(JSON.stringify(editRecord?.output)).toContain('Successfully replaced 2 block(s)');
});

test.for(['../other/README.md', 'alias/README.md', 'hardlink.txt'])(
  'blocks file mutations through %s',
  async (path, context) => {
    const { execute, outside, project, other } = await setupTools(context, 'workspace-write');
    if (path === 'alias/README.md') {
      await linkDirectory(other, join(project, 'alias'));
    } else if (path === 'hardlink.txt') {
      await link(outside, join(project, path));
    }
    const edits = [{ oldText: 'outside marker', newText: 'changed' }];
    expect((await execute('write', { path, content: 'denied' })).result?.isError).toBe(true);
    expect((await execute('edit', { path, edits })).result?.isError).toBe(true);
    expect(await readFile(outside, 'utf8')).toBe('outside marker');
  },
);

test('keeps the write tool inside the workspace even with full shell access', async (context) => {
  const { execute, outside } = await setupTools(context, 'full-access');
  expect((await execute('write', { path: outside, content: 'denied' })).result?.isError).toBe(true);
  expect(await readFile(outside, 'utf8')).toBe('outside marker');
});

test('records the shell result and schema seen by the model', async (context) => {
  const { execute, history, fetch, trajectoryUrl } = await setupTools(context, 'full-access');
  const shellRequest = await execute(shell, { command });
  expect(shellRequest.toolNames.toSorted()).toEqual(
    ['read', 'glob', 'grep', 'write', 'edit', shell, 'task'].toSorted(),
  );
  const ran = shellRequest.result;
  assert(ran);
  expect(ran.isError).toBe(false);
  expect(resultText(ran)).toContain('PI_SHELL_OK');
  const shellRun = (await history()).at(-1);
  const shellCall = shellRun?.records.find((record) => record.kind === 'tool');
  assert(shellRun && shellCall?.kind === 'tool' && shellCall.modelRequestId);
  const shellInput = trajectoryModelInputResponseSchema.parse(
    await (await fetch(`${trajectoryUrl}/${shellRun.id}/${shellCall.modelRequestId}`)).json(),
  );
  const shellSchema = shellRequest.toolSchemas.get(shell);
  expect(shellSchema).toMatchObject({ required: ['command'] });
  expect(shellCall).toMatchObject({
    name: shell,
    status: 'completed',
    input: { command },
    schema: shellSchema,
  });
  expect(JSON.stringify(shellCall.output)).toContain('PI_SHELL_OK');
  expect(shellInput.tools.map(({ name }) => name).toSorted()).toEqual(
    shellRequest.toolNames.toSorted(),
  );
  expect(shellInput.tools.find(({ name }) => name === shell)?.parameters).toEqual(shellSchema);
});

test('inherits the Host environment in the shell', async (context) => {
  const { execute } = await setupTools(context, 'full-access');
  vi.stubEnv('BELUGA_PI_FIXTURE_ENV', 'inherited-value');
  context.onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const envCommand = windows
    ? 'Write-Output $env:BELUGA_PI_FIXTURE_ENV'
    : 'printf "%s" "$BELUGA_PI_FIXTURE_ENV"';
  const inherited = (await execute(shell, { command: envCommand })).result;
  assert(inherited);
  expect(resultText(inherited)).toContain('inherited-value');
});

test('restores the failed shell call and access mode after restart', async (context) => {
  const { execute, restart, session, getRuntime, history } = await setupTools(
    context,
    'full-access',
  );
  const failed = (await execute(shell, { command: 'exit 7' })).result;
  assert(failed);
  expect(failed.isError).toBe(true);
  expect(resultText(failed)).toMatch(/code 7/);

  const before = await history();
  const shellFailure = before
    .flatMap(({ records }) => records)
    .find(
      (record) => record.kind === 'tool' && record.name === shell && record.status === 'failed',
    );
  assert(shellFailure?.kind === 'tool');
  expect(shellFailure.error).toMatch(/code 7/);
  await restart(allCapabilities);
  expect(await history()).toEqual(before);
  expect(getRuntime().get('workspaceToolSessions').sessionAccessMode(session.id)).toBe(
    'full-access',
  );
});

test(
  'rechecks access after the model has seen a shell tool',
  { timeout: 30_000 },
  async (context) => {
    const modelSawShell = latch();
    const release = latch();
    context.onTestFinished(release.release);
    const { client, send, setMode, history } = await setupTools(context, 'full-access', (call) => {
      expect(call.name).toBe(shell);
      modelSawShell.release();
      return release.wait;
    });
    const receipt = await send(shell, { command });
    try {
      await waitForStart(
        modelSawShell.wait,
        (signal) => client.wait(receipt, { signal }),
        'the model requested the shell',
      );
      await setMode('workspace-write');
    } finally {
      release.release();
    }
    await client.wait(receipt, { signal: AbortSignal.timeout(5_000) });
    const recorded = (await history())
      .at(-1)
      ?.records.find((record) => record.kind === 'tool' && record.name === shell);
    assert(recorded?.kind === 'tool');
    expect(recorded.status).toBe('failed');
    expect(recorded.error).toMatch(/session does not allow this tool/i);
  },
);

test(
  'cancels the running shell through Flue and records the interrupted submission',
  { timeout: 30_000 },
  async (context) => {
    const { client, send, project, history } = await setupTools(context, 'full-access');
    const server = createServer();
    let childSocket: Socket | undefined;
    const connected = new Promise<Socket>((resolve) => {
      server.once('connection', (socket) => {
        childSocket = socket;
        socket.on('error', () => {});
        resolve(socket);
      });
    });
    context.onTestFinished(() => {
      server.close();
      childSocket?.destroy();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address === 'object');

    // An open socket proves the child is running and detects its termination.
    await writeFile(
      join(project, 'descendant.cjs'),
      `require('node:net').connect(${address.port}, '127.0.0.1').on('error', () => {})`,
    );
    const command = windows
      ? `& '${process.execPath.replaceAll("'", "''")}' descendant.cjs`
      : `'${process.execPath.replaceAll("'", `'"'"'`)}' descendant.cjs & wait`;
    const receipt = await send(shell, { command, timeout: 12 });
    const socket = await waitForStart(
      connected,
      (signal) => client.wait(receipt, { signal }),
      'the shell child connected',
    );
    const closed = once(socket, 'close').catch(() => {});
    expect((await client.abort()).aborted).toBe(true);
    await expect(
      client.wait(receipt, { signal: AbortSignal.timeout(5_000) }),
    ).rejects.toMatchObject({
      failure: 'aborted',
    });
    await vi.waitFor(() => expect(socket.destroyed).toBe(true), { timeout: 5_000 });
    await closed;
    const request = (await history()).at(-1);
    expect(request?.status).toBe('interrupted');
    expect(request?.records).toContainEqual(expect.objectContaining({ kind: 'tool', name: shell }));
  },
);
