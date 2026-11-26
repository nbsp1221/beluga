import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type AssistantMessage,
  type Provider,
  type ToolCall,
  createAssistantMessageEventStream,
} from '@earendil-works/pi-ai';
import {
  agentSkillsCapabilityId,
  conversationUsageSchema,
  trajectoryModelInputResponseSchema,
} from '@workspace/protocol/host';
import { expect, test } from 'vitest';
import { origin, readTrajectory, setupHarness } from './fixtures/harness.js';
import { fixtureProvider } from './fixtures/model-provider.js';

const checkpoint = 'Keep the original decision to use port 4173.';

function toolResponse(model: Parameters<Provider['streamSimple']>[0], calls: ToolCall[]) {
  const message: AssistantMessage = {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: calls,
    stopReason: 'toolUse',
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { ...model.cost, total: 0 },
    },
  };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: 'start', partial: message });
  for (const [contentIndex, toolCall] of calls.entries()) {
    stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial: message });
  }
  stream.push({ type: 'done', reason: 'toolUse', message });
  return stream;
}

function compactionProvider(
  onSummary?: (signal?: AbortSignal) => Promise<void>,
  alternateWindow = 128_000,
  beforeReply?: () => Promise<void>,
): Provider {
  const provider = fixtureProvider([]);
  const [model] = provider.getModels();

  const streamSimple: Provider['streamSimple'] = (selected, context, options) => {
    const user = context.messages.findLast((message) => {
      if (message.role !== 'user') {
        return false;
      }
      const text =
        typeof message.content === 'string'
          ? message.content
          : message.content.find((part) => part.type === 'text')?.text;
      return !text?.startsWith('<system-reminder ');
    });
    const userInput = JSON.stringify(user ?? null);
    const summary = userInput.includes('<conversation>');
    const pressure = !summary && userInput.includes('Trigger threshold') ? 29_000 : 1_000;
    const stream = createAssistantMessageEventStream();
    const response: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: summary ? checkpoint : 'Reply.' }],
      api: selected.api,
      provider: selected.provider,
      model: selected.id,
      timestamp: Date.now(),
      stopReason: 'stop',
      usage: {
        input: pressure,
        cacheRead: 400,
        cacheWrite: 100,
        output: 50,
        totalTokens: pressure + 550,
        cost: { ...model.cost, total: 0 },
      },
    };

    const send = () => {
      if (
        !summary &&
        userInput.includes('Trigger overflow') &&
        !JSON.stringify(context.messages).includes(checkpoint)
      ) {
        stream.push({
          type: 'error',
          reason: 'error',
          error: {
            ...response,
            stopReason: 'error',
            errorMessage: 'maximum context length exceeded',
          },
        });
        return;
      }
      stream.push({ type: 'done', reason: 'stop', message: response });
    };

    const hold = summary
      ? onSummary?.(options?.signal)
      : userInput.includes('Hold model response')
        ? beforeReply?.()
        : undefined;
    if (hold) {
      void hold.then(send, (error: unknown) => {
        const reason = options?.signal?.aborted ? 'aborted' : 'error';
        stream.push({
          type: 'error',
          reason,
          error: { ...response, stopReason: reason, errorMessage: String(error) },
        });
      });
    } else {
      send();
    }
    return stream;
  };

  return {
    ...provider,
    getModels: () => [model, { ...model, id: 'alternate', contextWindow: alternateWindow }],
    stream: (selected, context) => streamSimple(selected, context),
    streamSimple,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test(
  'ignores a late response after model selection changes and hides unknown windows',
  { timeout: 30_000 },
  async (context) => {
    const responding = deferred();
    const releaseReply = deferred();
    const harness = await setupHarness(context, [], undefined, () =>
      compactionProvider(undefined, 0, async () => {
        responding.resolve();
        await releaseReply.promise;
      }),
    );
    const workspace = await harness.prepareWorkspace();
    const preset = await harness.createPreset();
    const { id } = await harness.create(workspace.id, preset.id);
    const base = `${origin}/api/conversations/${id}`;
    const client = harness.sdk(id);

    const send = (body: string) =>
      client.send({
        message: { kind: 'user', body },
        initialData: { sessionId: id },
        idempotencyKey: crypto.randomUUID(),
      });

    const select = (model: string) =>
      harness.fetch(`${base}/run-settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, effort: 'default' }),
      });

    const usage = async () =>
      conversationUsageSchema.parse(await (await harness.fetch(`${base}/usage`)).json());

    const receipt = await send('Hold model response');
    const settled = client.wait(receipt, { signal: AbortSignal.timeout(5000) });
    try {
      await Promise.race([responding.promise, settled]);
      expect((await select('test-read/alternate')).status).toBe(200);
      expect((await select('test-read/fixture')).status).toBe(200);
    } finally {
      releaseReply.resolve();
    }
    await settled;
    expect((await usage()).context).toEqual({ status: 'unavailable' });
    expect((await select('test-read/alternate')).status).toBe(200);
    await client.wait(await send('Reply with unknown model limits.'), {
      signal: AbortSignal.timeout(5000),
    });
    expect((await usage()).context).toEqual({ status: 'unavailable' });
    expect((await usage()).tokens).toBe(3_100);
  },
);

test(
  'observes Flue compaction, refreshes context after the next request and restores the checkpoint',
  { timeout: 30_000 },
  async (context) => {
    const summaryStarted = deferred();
    const releaseSummary = deferred();
    const harness = await setupHarness(context, [], undefined, () =>
      compactionProvider(async () => {
        summaryStarted.resolve();
        await releaseSummary.promise;
      }),
    );
    await writeFile(join(harness.project, 'AGENTS.md'), 'FIXTURE_RULE_SURVIVES_COMPACTION');
    const workspace = await harness.prepareWorkspace();
    const preset = await harness.createPreset(['agent-instructions']);
    const { id } = await harness.create(workspace.id, preset.id);
    const url = `${origin}/api/conversations/${id}`;
    const client = harness.sdk(id);

    const usage = async () =>
      conversationUsageSchema.parse(await (await harness.fetch(`${url}/usage`)).json());

    const history = async () => await readTrajectory(harness.fetch(`${url}/trajectory`));

    const send = (body: string) =>
      client.send({
        message: { kind: 'user', body },
        initialData: { sessionId: id },
        idempotencyKey: crypto.randomUUID(),
      });

    const wait = async (body: string) =>
      client.wait(await send(body), { signal: AbortSignal.timeout(5000) });

    expect((await usage()).context).toEqual({ status: 'unavailable' });
    for (let i = 0; i < 4; i++) {
      await wait(`Seed ${i}: ${'work '.repeat(4_000)}`);
    }
    expect((await usage()).context).toMatchObject({
      status: 'available',
      inputTokens: 1500,
      contextWindow: 32_000,
    });

    const receipt = await send('Trigger threshold');
    try {
      await Promise.race([
        summaryStarted.promise,
        client.wait(receipt, { signal: AbortSignal.timeout(5000) }),
      ]);
      expect((await usage()).context).toEqual({ status: 'compacting' });
    } finally {
      releaseSummary.resolve();
    }
    await client.wait(receipt, { signal: AbortSignal.timeout(5000) });
    expect((await usage()).context).toEqual({ status: 'unavailable' });
    expect((await usage()).tokens).toBe(37_300);
    const compacted = (await history())
      .flatMap(({ records }) => records)
      .find((record) => record.kind === 'compaction');
    expect(compacted).toMatchObject({ reason: 'threshold', status: 'completed' });
    assert(compacted);
    const summary = (await history())
      .flatMap(({ records }) => records)
      .find((record) => record.kind === 'assistant' && record.compactionId === compacted.id);
    assert(summary?.kind === 'assistant');
    expect(summary).toMatchObject({ purpose: 'compaction' });
    expect(summary.text).toContain(checkpoint);

    await harness.restart();
    expect((await usage()).context).toEqual({ status: 'unavailable' });
    const transcript = JSON.stringify((await client.history()).messages);
    expect(transcript).toContain('Seed 0');
    expect(transcript).not.toContain(checkpoint);
    await wait('Continue after restart.');
    const requests = await history();
    const last = requests.at(-1);
    const model = last?.records.find((record) => record.kind === 'assistant');
    assert(last && model);
    expect(model).toMatchObject({ purpose: 'agent', contextCompacted: true });
    const input = trajectoryModelInputResponseSchema.parse(
      await (await harness.fetch(`${url}/trajectory/${last.id}/${model.id}`)).json(),
    );
    expect(JSON.stringify(input.messages)).toContain(checkpoint);
    expect(JSON.stringify(input.messages).match(/FIXTURE_RULE_SURVIVES_COMPACTION/g)).toHaveLength(
      1,
    );
    expect(last.records.some((record) => record.kind === 'system')).toBe(false);
    expect((await usage()).context).toMatchObject({ status: 'available', inputTokens: 1500 });
  },
);

test.for(['threshold', 'overflow'] as const)(
  'publishes the current catalog and reloads a skill after %s compaction',
  async (reason, context) => {
    const oldBody = 'ORIGINAL_SKILL_BODY';
    const newBody = 'RELOADED_SKILL_BODY';
    const oldDescription = 'Old review instructions';
    const newDescription = 'Updated review instructions';
    let skillFile = '';

    const skill = (description: string, body: string) =>
      `---\nname: review\ndescription: ${description}\n---\n\n${body}\n`;

    const harness = await setupHarness(context, [], undefined, () => {
      const provider = compactionProvider(async () => {
        await writeFile(skillFile, skill(newDescription, newBody));
      });
      return {
        ...provider,
        streamSimple(model, input, options) {
          const last = input.messages.at(-1);
          if (
            last?.role === 'user' &&
            JSON.stringify(last.content).includes('Reload the review skill')
          ) {
            return toolResponse(model, [
              {
                type: 'toolCall',
                id: 'reload-review',
                name: 'skill',
                arguments: { name: 'review' },
              },
            ]);
          }
          return provider.streamSimple(model, input, options);
        },
      };
    });
    const directory = join(dirname(harness.databasePath), 'skills', 'review');
    skillFile = join(directory, 'SKILL.md');
    await mkdir(directory, { recursive: true });
    await writeFile(skillFile, skill(oldDescription, oldBody));
    const workspace = await harness.prepareWorkspace();
    const preset = await harness.createPreset([agentSkillsCapabilityId]);
    const { id } = await harness.create(workspace.id, preset.id);
    const client = harness.sdk(id);

    const submit = async (body: string) =>
      client.wait(await client.send({ message: { kind: 'user', body } }), {
        signal: context.signal,
      });

    const path = `${origin}/api/conversations/${id}/trajectory`;

    const history = () => readTrajectory(harness.fetch(path));

    const latestInput = async () => {
      const turn = (await history()).at(-1);
      const model = turn?.records.findLast(
        (record) => record.kind === 'assistant' && record.purpose === 'agent',
      );
      assert(turn && model);
      const response = await harness.fetch(`${path}/${turn.id}/${model.id}`);
      return trajectoryModelInputResponseSchema.parse(await response.json());
    };

    await submit('/review check the change');
    const initial = await latestInput();
    expect(JSON.stringify(initial)).toContain(oldDescription);
    expect(JSON.stringify(initial.messages)).toContain(oldBody);
    for (let index = 0; index < 4; index++) {
      await submit(`Seed ${index}: ${'work '.repeat(4_000)}`);
    }
    await submit(reason === 'threshold' ? 'Trigger threshold' : 'Trigger overflow');
    const compaction = (await history())
      .flatMap(({ records }) => records)
      .find((record) => record.kind === 'compaction' && record.reason === reason);
    expect(compaction).toMatchObject({ status: 'completed' });
    if (reason === 'threshold') {
      await submit('Continue with the current catalog');
    }
    const compacted = await latestInput();
    expect(JSON.stringify(compacted)).toContain(newDescription);
    expect(JSON.stringify(compacted)).not.toContain(oldDescription);
    expect(JSON.stringify(compacted.messages)).toContain(checkpoint);
    expect(JSON.stringify(compacted.messages)).not.toMatch(new RegExp(`${oldBody}|${newBody}`));

    await submit('Reload the review skill');
    const reloaded = JSON.stringify((await latestInput()).messages);
    expect(reloaded).toContain(newBody);
    expect(reloaded).not.toContain(oldBody);
  },
);

test('reports context usage for the selected model after it responds', async (context) => {
  const harness = await setupHarness(context, [], undefined, () => compactionProvider());
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset();
  const { id } = await harness.create(workspace.id, preset.id);
  const url = `${origin}/api/conversations/${id}`;

  const usage = async () =>
    conversationUsageSchema.parse(await (await harness.fetch(`${url}/usage`)).json());

  await harness.turn(id, 'Reply with the initial model.');

  const select = async (model: string, effort = 'default') => {
    const response = await harness.fetch(`${url}/run-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, effort }),
    });
    expect(response.status).toBe(200);
  };

  await select('test-read/fixture', 'low');
  expect((await usage()).context?.status).toBe('available');
  await select('test-read/alternate');
  expect((await usage()).context?.status).toBe('unavailable');
  await select('test-read/fixture');
  expect((await usage()).context?.status).toBe('unavailable');
  await select('test-read/alternate');
  await harness.turn(id, 'Use the alternate model.');
  const alternate = (await usage()).context;
  expect(alternate).toMatchObject({
    status: 'available',
    inputTokens: 1500,
    contextWindow: 128_000,
    model: 'test-read/alternate',
  });
  expect(alternate?.status === 'available' && alternate.estimatedTokens?.messages).toBeGreaterThan(
    0,
  );
});

test('restores workspace instructions in the model request that retries an overflow', async (context) => {
  const rule = 'FIXTURE_RULE_SURVIVES_OVERFLOW';
  const harness = await setupHarness(context, [], undefined, () => compactionProvider());
  await writeFile(join(harness.project, 'AGENTS.md'), rule);
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset(['agent-instructions']);
  const { id } = await harness.create(workspace.id, preset.id);
  for (let index = 0; index < 4; index++) {
    await harness.turn(id, `Seed ${index}: ${'work '.repeat(4_000)}`);
  }
  await harness.turn(id, 'Trigger overflow');

  const url = `${origin}/api/conversations/${id}/trajectory`;
  const overflowTurn = (await readTrajectory(harness.fetch(url))).at(-1);
  assert(overflowTurn);
  expect(overflowTurn.records).toContainEqual(
    expect.objectContaining({ kind: 'compaction', reason: 'overflow', status: 'completed' }),
  );
  const attempts = overflowTurn.records.filter(
    (record) => record.kind === 'assistant' && record.purpose === 'agent',
  );
  expect(attempts).toMatchObject([
    { status: 'failed' },
    { status: 'completed', contextCompacted: true },
  ]);
  const inputs = await Promise.all(
    attempts.map(async ({ id }) => {
      const response = await harness.fetch(`${url}/${overflowTurn.id}/${id}`);
      return trajectoryModelInputResponseSchema.parse(await response.json());
    }),
  );
  expect(JSON.stringify(inputs[0].messages)).toContain(rule);
  const retry = JSON.stringify(inputs[1].messages);
  expect(retry).toContain(checkpoint);
  expect(retry.match(new RegExp(rule, 'g')) ?? []).toHaveLength(1);
});

test.for(['failed', 'interrupted', 'overflow'] as const)(
  'records a %s compaction outcome from Flue',
  { timeout: 30_000 },
  async (outcome, context) => {
    const summaryStarted = deferred();
    const harness = await setupHarness(context, [], undefined, () =>
      compactionProvider(async (signal) => {
        summaryStarted.resolve();
        if (outcome === 'failed') {
          throw new Error('Summary fixture failed');
        }
        if (outcome === 'interrupted') {
          await new Promise<void>((_, reject) => {
            if (signal?.aborted) {
              reject(new DOMException('Summary cancelled', 'AbortError'));
            } else {
              signal?.addEventListener(
                'abort',
                () => reject(new DOMException('Summary cancelled', 'AbortError')),
                { once: true },
              );
            }
          });
        }
      }),
    );
    const workspace = await harness.prepareWorkspace();
    const preset = await harness.createPreset();
    const { id } = await harness.create(workspace.id, preset.id);
    const client = harness.sdk(id);

    const send = (body: string) =>
      client.send({
        message: { kind: 'user', body },
        initialData: { sessionId: id },
        idempotencyKey: crypto.randomUUID(),
      });

    for (let index = 0; index < 4; index++) {
      await client.wait(await send(`Seed ${index}: ${'work '.repeat(4_000)}`), {
        signal: AbortSignal.timeout(5000),
      });
    }
    const receipt = await send(outcome === 'overflow' ? 'Trigger overflow' : 'Trigger threshold');
    const settled = client.wait(receipt, { signal: AbortSignal.timeout(5000) });
    if (outcome === 'interrupted') {
      await Promise.race([summaryStarted.promise, settled]);
      await client.abort();
    }
    await settled;
    const base = `${origin}/api/conversations/${id}`;
    const history = await readTrajectory(harness.fetch(`${base}/trajectory`));
    const records = history.at(-1)?.records ?? [];
    expect(records.filter(({ kind }) => kind === 'compaction')).toMatchObject([
      {
        reason: outcome === 'overflow' ? 'overflow' : 'threshold',
        status: outcome === 'overflow' ? 'completed' : outcome,
      },
    ]);
    const last = records.at(-1);
    expect(
      last?.kind === 'assistant' && last.contextCompacted === true && last.status === 'completed',
    ).toBe(outcome === 'overflow');
    const usage = conversationUsageSchema.parse(
      await (await harness.fetch(`${base}/usage`)).json(),
    );
    expect(usage.context?.status).toBe('available');
  },
);
