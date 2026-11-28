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

interface SummaryFixture {
  text: string;
  stopReason: 'stop' | 'length';
}

function compactionProvider(
  onSummary?: (signal: AbortSignal | undefined, input: string) => Promise<void | SummaryFixture>,
  alternateWindow = 128_000,
  beforeReply?: () => Promise<void>,
  maxInputCharacters?: number,
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
    const pressure =
      maxInputCharacters !== undefined
        ? Math.ceil(JSON.stringify(context.messages).length / 4)
        : !summary && userInput.includes('Trigger threshold')
          ? 29_000
          : 1_000;
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

    const send = (result?: void | SummaryFixture) => {
      if (
        (maxInputCharacters !== undefined &&
          JSON.stringify(context.messages).length > maxInputCharacters) ||
        (!summary &&
          userInput.includes('Trigger overflow') &&
          !JSON.stringify(context.messages).includes(checkpoint))
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
      const message: AssistantMessage = result
        ? {
            ...response,
            content: [{ type: 'text', text: result.text }],
            stopReason: result.stopReason,
          }
        : response;
      stream.push({ type: 'done', reason: result?.stopReason ?? 'stop', message });
    };

    const hold = summary
      ? onSummary?.(options?.signal, userInput)
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

test.for([
  { history: 'short', turns: 1, skillWords: 7_500 },
  { history: 'long', turns: 4, skillWords: 3_500 },
])(
  'keeps pending manual skills only in the retained history with $history history',
  async (entry, context) => {
    const marker = 'MANUAL_SKILL_WAITING_FOR_RESPONSE';
    const summaries: string[] = [];
    const overflowRequests: string[] = [];
    const harness = await setupHarness(context, [], undefined, () => {
      const provider = compactionProvider();
      return {
        ...provider,
        streamSimple(model, input, options) {
          const messages = JSON.stringify(input.messages);
          if (messages.includes('<conversation>')) {
            summaries.push(messages);
          } else if (messages.includes('Trigger overflow') || messages.includes(checkpoint)) {
            overflowRequests.push(messages);
          }
          return provider.streamSimple(model, input, options);
        },
      };
    });
    const skills = join(dirname(harness.databasePath), 'skills');
    for (const [name, body] of [
      ['review', marker],
      ['long', 'Long skill body '.repeat(entry.skillWords)],
    ]) {
      await mkdir(join(skills, name), { recursive: true });
      await writeFile(
        join(skills, name, 'SKILL.md'),
        `---\nname: ${name}\ndescription: Fixture skill\n---\n\n${body}\n`,
      );
    }
    const workspace = await harness.prepareWorkspace();
    const preset = await harness.createPreset([agentSkillsCapabilityId]);
    const { id } = await harness.create(workspace.id, preset.id);
    const client = harness.sdk(id);

    const submit = async (body: string) =>
      client.wait(await client.send({ message: { kind: 'user', body } }), {
        signal: context.signal,
      });

    for (let index = 0; index < entry.turns; index++) {
      await submit(`Earlier history ${index}: ${'seed '.repeat(4_000)}`);
    }
    await submit('/review /long Trigger overflow');
    expect(overflowRequests).toHaveLength(2);
    expect(overflowRequests[0]).toContain(marker);
    expect(overflowRequests[1]).toContain('Long skill body');
    expect(overflowRequests[1]).not.toContain(marker);
    expect(summaries).not.toHaveLength(0);
    expect(summaries.join('\n')).toContain('Earlier history');
    expect(summaries.join('\n')).not.toMatch(/MANUAL_SKILL_WAITING_FOR_RESPONSE|Long skill body/);
  },
);

test.for([42_000, 68_000])(
  'compacts earlier history before admitting %i-character inputs from the queue',
  async (length, context) => {
    const inputLimit = 128_000;
    const responding = deferred();
    const releaseReply = deferred();
    const requests: { summary: boolean; input: string }[] = [];
    const harness = await setupHarness(context, [], undefined, () => {
      const provider = compactionProvider(
        undefined,
        undefined,
        async () => {
          responding.resolve();
          await releaseReply.promise;
        },
        inputLimit,
      );
      return {
        ...provider,
        streamSimple(model, input, options) {
          const serialized = JSON.stringify(input.messages);
          requests.push({ summary: serialized.includes('<conversation>'), input: serialized });
          return provider.streamSimple(model, input, options);
        },
      };
    });
    const workspace = await harness.prepareWorkspace();
    const preset = await harness.createPreset();
    const { id } = await harness.create(workspace.id, preset.id);
    const url = `${origin}/api/conversations/${id}/trajectory`;
    const client = harness.sdk(id);

    const send = (body: string) =>
      client.send({ message: { kind: 'user', body }, signal: context.signal });

    const wait = (receipt: Awaited<ReturnType<typeof send>>) =>
      client.wait(receipt, { signal: context.signal });

    for (let index = 0; index < 4; index++) {
      await wait(await send(`Earlier history ${index} `.padEnd(24_000, 's')));
    }
    const running = wait(await send('Hold model response'));
    const first = 'First queued long input';
    const second = 'Second queued long input';
    try {
      await Promise.race([responding.promise, running]);
      const queued = [
        await send('Short queued input'),
        await send(first.padEnd(length, 'a')),
        await send(second.padEnd(length, 'b')),
      ];
      releaseReply.resolve();
      await Promise.all([running, ...queued.map(wait)]);
    } finally {
      releaseReply.resolve();
    }
    await wait(await send('Short follow-up'));

    const firstSummary = requests.findIndex(({ summary }) => summary);
    expect(firstSummary).toBeGreaterThanOrEqual(0);
    expect(requests[firstSummary].input).toContain('Earlier history');
    expect(requests.every(({ input }) => input.length <= inputLimit)).toBe(true);
    expect(
      requests.some(({ summary, input }) => !summary && input.includes('Short queued input')),
    ).toBe(true);
    for (const marker of [first, second]) {
      const firstUse = requests.findIndex(({ input }) => input.includes(marker));
      expect(firstUse).toBeGreaterThan(firstSummary);
      expect(requests[firstUse].summary).toBe(false);
      expect(requests[firstUse].input).toContain(checkpoint);
    }

    const trajectory = await readTrajectory(harness.fetch(url));
    const records = trajectory.flatMap((turn) => turn.records);
    const answers = records
      .filter((record) => record.kind === 'assistant')
      .filter((record) => record.purpose === 'agent');
    expect(answers.every(({ status }) => status === 'completed')).toBe(true);
    expect(answers.at(-1)?.text).toBe('Reply.');
    expect(requests.at(-1)?.input).toContain('Short follow-up');
    const summaryTurn = trajectory.find(({ records }) =>
      records.some((record) => record.kind === 'assistant' && record.purpose === 'compaction'),
    );
    assert(summaryTurn);
    const summaryRecord = summaryTurn.records.find(
      (record) => record.kind === 'assistant' && record.purpose === 'compaction',
    );
    assert(summaryRecord);
    const snapshot = trajectoryModelInputResponseSchema.parse(
      await (await harness.fetch(`${url}/${summaryTurn.id}/${summaryRecord.id}`)).json(),
    );
    const summaryInput = JSON.stringify(snapshot.messages);
    expect(summaryInput).toContain('Earlier history');
    expect(summaryInput).not.toContain(first);
    expect(summaryInput).not.toContain(second);
  },
);

test.for(['blank', 'truncated'] as const)(
  'keeps the earlier decision when preflight returns a %s summary',
  async (outcome, context) => {
    const decision = 'Keep port 4173 for the rollout';
    const harness = await setupHarness(context, [], undefined, () =>
      compactionProvider(
        () =>
          Promise.resolve(
            outcome === 'blank'
              ? { text: ' \n', stopReason: 'stop' }
              : { text: '## Goal\nThe rollout', stopReason: 'length' },
          ),
        undefined,
        undefined,
        128_000,
      ),
    );
    const workspace = await harness.prepareWorkspace();
    const preset = await harness.createPreset();
    const { id } = await harness.create(workspace.id, preset.id);
    const client = harness.sdk(id);

    const submit = async (body: string) => {
      const receipt = await client.send({
        message: { kind: 'user', body },
        signal: context.signal,
      });
      await client.wait(receipt, { signal: context.signal });
    };

    await submit(decision.padEnd(24_000, 's'));
    for (let index = 1; index < 4; index++) {
      await submit(`Earlier history ${index} `.padEnd(24_000, 's'));
    }
    await submit('A new message crossing the compaction threshold '.padEnd(20_000, 'n'));

    const url = `${origin}/api/conversations/${id}/trajectory`;
    const turn = (await readTrajectory(harness.fetch(url))).at(-1);
    assert(turn);
    const firstCompaction = turn.records.findIndex(({ kind }) => kind === 'compaction');
    const agentRequest = turn.records.find(
      (record) => record.kind === 'assistant' && record.purpose === 'agent',
    );
    assert(agentRequest);
    expect(firstCompaction).toBeGreaterThanOrEqual(0);
    expect(firstCompaction).toBeLessThan(turn.records.indexOf(agentRequest));
    expect(turn.records[firstCompaction]).toMatchObject({ reason: 'threshold', status: 'failed' });
    expect(agentRequest).toMatchObject({ status: 'completed' });
    const input = trajectoryModelInputResponseSchema.parse(
      await (await harness.fetch(`${url}/${turn.id}/${agentRequest.id}`)).json(),
    );
    expect(JSON.stringify(input.messages)).toContain(decision);
  },
);

test('carries an earlier checkpoint into a split with no new history to summarize', async (context) => {
  const originalDecision = 'Retain the decision to use port 4173.';
  const retainedWork = 'Continue reviewing the current workspace.';
  const harness = await setupHarness(context, [], undefined, () =>
    compactionProvider((_signal, input) =>
      Promise.resolve({
        text: input.includes(originalDecision) ? checkpoint : retainedWork,
        stopReason: 'stop',
      }),
    ),
  );
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset();
  const { id } = await harness.create(workspace.id, preset.id);
  const client = harness.sdk(id);

  const submit = async (body: string) =>
    client.wait(await client.send({ message: { kind: 'user', body }, signal: context.signal }), {
      signal: context.signal,
    });

  await submit(originalDecision.padEnd(40_000, 'a'));
  await submit('Trigger threshold while reviewing files'.padEnd(36_000, 'a'));
  const incoming = 'Continue after the split';
  await submit(incoming.padEnd(84_000, 'a'));

  const url = `${origin}/api/conversations/${id}/trajectory`;
  const turn = (await readTrajectory(harness.fetch(url))).at(-1);
  const compaction = turn?.records.find(({ kind }) => kind === 'compaction');
  const prefix = turn?.records.find(
    (record) => record.kind === 'assistant' && record.purpose === 'compaction_prefix',
  );
  const agent = turn?.records.find(
    (record) => record.kind === 'assistant' && record.purpose === 'agent',
  );
  assert(turn && prefix && agent);
  expect(compaction).toMatchObject({ reason: 'threshold', status: 'completed' });
  expect(prefix).toMatchObject({ status: 'completed' });
  const input = trajectoryModelInputResponseSchema.parse(
    await (await harness.fetch(`${url}/${turn.id}/${agent.id}`)).json(),
  );
  const messages = JSON.stringify(input.messages);
  expect(messages.includes(checkpoint), 'earlier checkpoint reaches the model').toBe(true);
  expect(messages.includes(retainedWork), 'new split summary reaches the model').toBe(true);
  expect(messages.includes(incoming), 'pending input reaches the model').toBe(true);
});

test('rejects a split with an invalid history summary before calling the prefix model', async (context) => {
  const originalDecision = 'Keep the original rollout configuration';
  const releasePrefix = deferred();
  const retainedTurn = 'This is the beginning of the retained turn';
  const harness = await setupHarness(context, [], undefined, () =>
    compactionProvider(
      async (_signal, input) => {
        if (input.includes(retainedTurn) && input.includes('This is the PREFIX of a turn')) {
          await releasePrefix.promise;
          return;
        }
        return { text: 'An incomplete summary', stopReason: 'length' };
      },
      undefined,
      undefined,
      128_000,
    ),
  );
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset();
  const { id } = await harness.create(workspace.id, preset.id);
  const client = harness.sdk(id);

  const submit = async (body: string) =>
    client.wait(await client.send({ message: { kind: 'user', body }, signal: context.signal }), {
      signal: context.signal,
    });

  try {
    await submit(originalDecision.padEnd(8_000, 'a'));
    await submit(retainedTurn.padEnd(26_000, 'a'));
    await submit('Continue the rollout'.padEnd(90_000, 'a'));

    const url = `${origin}/api/conversations/${id}/trajectory`;
    const turn = (await readTrajectory(harness.fetch(url))).at(-1);
    const compaction = turn?.records.find(({ kind }) => kind === 'compaction');
    const agent = turn?.records.find(
      (record) => record.kind === 'assistant' && record.purpose === 'agent',
    );
    assert(turn && agent);
    expect(compaction).toMatchObject({ reason: 'threshold', status: 'failed' });
    expect(turn.records).not.toContainEqual(
      expect.objectContaining({ kind: 'assistant', purpose: 'compaction_prefix' }),
    );
    expect(agent).toMatchObject({ status: 'completed' });
    const input = trajectoryModelInputResponseSchema.parse(
      await (await harness.fetch(`${url}/${turn.id}/${agent.id}`)).json(),
    );
    expect(JSON.stringify(input.messages).includes(originalDecision)).toBe(true);
  } finally {
    releasePrefix.resolve();
  }
});

test('preserves the accepted message when preflight compaction is stopped', async (context) => {
  const summaryStarted = deferred();
  const releaseSummary = deferred();
  let pause = true;
  const harness = await setupHarness(context, [], undefined, () =>
    compactionProvider(
      async (signal) => {
        if (!pause) {
          return;
        }
        pause = false;
        summaryStarted.resolve();
        await Promise.race([
          releaseSummary.promise,
          new Promise<never>((_, reject) => {
            if (signal?.aborted) {
              reject(new DOMException('Summary cancelled', 'AbortError'));
            } else {
              signal?.addEventListener(
                'abort',
                () => reject(new DOMException('Summary cancelled', 'AbortError')),
                { once: true },
              );
            }
          }),
        ]);
      },
      undefined,
      undefined,
      128_000,
    ),
  );
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset();
  const { id } = await harness.create(workspace.id, preset.id);
  const client = harness.sdk(id);

  const send = (body: string) =>
    client.send({ message: { kind: 'user', body }, signal: context.signal });

  for (let index = 0; index < 4; index++) {
    await client.wait(await send(`Earlier history ${index} `.padEnd(24_000, 's')), {
      signal: context.signal,
    });
  }

  const marker = 'New message during compaction';
  const receipt = await send(marker.padEnd(42_000, 'n'));
  const settlement = client.wait(receipt, { signal: context.signal }).then(
    () => ({ outcome: 'completed' }),
    (error: unknown) => ({ error }),
  );

  try {
    await Promise.race([
      summaryStarted.promise,
      settlement.then(() => {
        throw new Error('Submission settled before compaction started');
      }),
    ]);

    const reconnected = await harness.sdk(id).history();
    const visibleMessage = reconnected.messages.find(
      (message) =>
        message.role === 'user' &&
        message.display === 'visible' &&
        message.submissionId === receipt.submissionId,
    );
    expect(
      visibleMessage?.parts.some((part) => part.type === 'text' && part.text.includes(marker)),
    ).toBe(true);
    expect(
      reconnected.settlements.some(({ submissionId }) => submissionId === receipt.submissionId),
    ).toBe(false);

    const url = `${origin}/api/conversations/${id}/trajectory`;
    const turn = (await readTrajectory(harness.fetch(url))).at(-1);
    const summary = turn?.records.find(
      (record) => record.kind === 'assistant' && record.purpose === 'compaction',
    );
    assert(turn && summary);
    const request = trajectoryModelInputResponseSchema.parse(
      await (await harness.fetch(`${url}/${turn.id}/${summary.id}`)).json(),
    );
    expect(JSON.stringify(request.messages)).toContain('Earlier history');
    expect(JSON.stringify(request.messages)).not.toContain(marker);

    await harness.sdk(id).abort();
    expect(await settlement).toMatchObject({ error: { failure: 'aborted' } });
    await harness.restart();
    const history = await harness.sdk(id).history();
    expect(JSON.stringify(history.messages)).toContain(marker);
    expect(history.settlements).toContainEqual(
      expect.objectContaining({ submissionId: receipt.submissionId, outcome: 'aborted' }),
    );
  } finally {
    releaseSummary.resolve();
  }
});

test('runs a pending skill before compacting to admit queued long inputs', async (context) => {
  const inputLimit = 128_000;
  const pendingReview = 'PENDING_REVIEW_SKILL_BODY';
  const responding = deferred();
  const releaseReply = deferred();
  const requests: { summary: boolean; input: string }[] = [];
  const harness = await setupHarness(context, [], undefined, () => {
    const provider = compactionProvider(
      undefined,
      undefined,
      async () => {
        responding.resolve();
        await releaseReply.promise;
      },
      inputLimit,
    );
    return {
      ...provider,
      streamSimple(model, input, options) {
        const serialized = JSON.stringify(input.messages);
        requests.push({ summary: serialized.includes('<conversation>'), input: serialized });
        return provider.streamSimple(model, input, options);
      },
    };
  });
  const skill = join(dirname(harness.databasePath), 'skills', 'review');
  await mkdir(skill, { recursive: true });
  await writeFile(
    join(skill, 'SKILL.md'),
    `---\nname: review\ndescription: Review a change\ndisable-model-invocation: true\n---\n\n${pendingReview}\n`,
  );
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset([agentSkillsCapabilityId]);
  const { id } = await harness.create(workspace.id, preset.id);
  const client = harness.sdk(id);

  const send = (body: string) =>
    client.send({ message: { kind: 'user', body }, signal: context.signal });

  const wait = (receipt: Awaited<ReturnType<typeof send>>) =>
    client.wait(receipt, { signal: context.signal });

  const receipt = await send('Hold model response');
  const continued = wait(receipt);
  try {
    await Promise.race([responding.promise, continued]);
    const deliveries = [
      await send('/review'),
      await send('First joined message '.padEnd(68_000, 'a')),
      await send('Latest joined message '.padEnd(68_000, 'z')),
    ];
    releaseReply.resolve();
    await Promise.all([continued, ...deliveries.map(wait)]);
  } finally {
    releaseReply.resolve();
  }

  const skillRequest = requests.findIndex(
    ({ summary, input }) => !summary && input.includes(pendingReview),
  );
  const firstInput = requests.findIndex(({ input }) => input.includes('First joined message'));
  const latestInput = requests.findIndex(({ input }) => input.includes('Latest joined message'));
  expect(skillRequest).toBeGreaterThanOrEqual(0);
  expect(firstInput).toBeGreaterThanOrEqual(skillRequest);
  expect(latestInput).toBeGreaterThan(firstInput);
  expect(requests[firstInput].summary).toBe(false);
  expect(requests[latestInput].summary).toBe(false);
  expect(requests.slice(firstInput + 1, latestInput).some(({ summary }) => summary)).toBe(true);
  expect(requests.every(({ input }) => input.length <= inputLimit)).toBe(true);
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
