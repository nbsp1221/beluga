import assert from 'node:assert/strict';
import {
  type AssistantMessage,
  type Provider,
  createAssistantMessageEventStream,
} from '@earendil-works/pi-ai';
import {
  conversationUsageSchema,
  trajectoryModelInputResponseSchema,
} from '@workspace/protocol/host';
import { expect, test } from 'vitest';
import { origin, readTrajectory, setupHarness } from './fixtures/harness.js';
import { fixtureProvider } from './fixtures/model-provider.js';

const checkpoint = 'Keep the original decision to use port 4173.';

function compactionProvider(
  onSummary?: (signal?: AbortSignal) => Promise<void>,
  alternateWindow = 128_000,
  beforeReply?: () => Promise<void>,
): Provider {
  const provider = fixtureProvider([]);
  const [model] = provider.getModels();

  const streamSimple: Provider['streamSimple'] = (selected, context, options) => {
    const user = JSON.stringify(context.messages.findLast(({ role }) => role === 'user') ?? null);
    const summary = user.includes('<conversation>');
    const pressure = !summary && user.includes('Trigger threshold') ? 29_000 : 1_000;
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
        user.includes('Trigger overflow') &&
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
      : user.includes('Hold model response')
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
    const workspace = await harness.prepareWorkspace();
    const preset = await harness.createPreset();
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
    expect(last.records.some((record) => record.kind === 'system')).toBe(false);
    expect((await usage()).context).toMatchObject({ status: 'available', inputTokens: 1500 });

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
    await wait('Use the alternate model.');
    const alternate = (await usage()).context;
    expect(alternate).toMatchObject({
      status: 'available',
      inputTokens: 1500,
      contextWindow: 128_000,
      model: 'test-read/alternate',
    });
    expect(
      alternate?.status === 'available' && alternate.estimatedTokens?.messages,
    ).toBeGreaterThan(0);
  },
);

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
