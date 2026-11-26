import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type AssistantMessage,
  type Provider,
  type ToolCall,
  createAssistantMessageEventStream,
} from '@earendil-works/pi-ai';
import { instrument } from '@flue/runtime';
import {
  agentSkillsCapabilityId,
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

test.for(['threshold', 'overflow', 'trajectory write failure'] as const)(
  'restores an activated skill once after %s compaction',
  async (reason, context) => {
    const harness = await setupHarness(context, [], undefined, () => compactionProvider());
    const skillDirectory = join(dirname(harness.databasePath), 'skills', 'compact');
    await mkdir(skillDirectory, { recursive: true });
    const marker = 'QA_ACTIVE_SKILL_SURVIVES_COMPACTION';
    await writeFile(
      join(skillDirectory, 'SKILL.md'),
      `---\nname: compact\ndescription: Keep a decision\n---\n\n${marker}\n`,
    );
    const workspace = await harness.prepareWorkspace();
    const preset = await harness.createPreset([agentSkillsCapabilityId]);
    const { id } = await harness.create(workspace.id, preset.id);
    const client = harness.sdk(id);

    const submit = async (body: string) =>
      client.wait(await client.send({ message: { kind: 'user', body } }), {
        signal: AbortSignal.timeout(5_000),
      });

    if (reason === 'trajectory write failure') {
      using db = new DatabaseSync(`${harness.databasePath}.trajectory`);
      db.exec(`CREATE TRIGGER fail_context_write BEFORE INSERT ON trajectory_record
        WHEN NEW.record_id LIKE 'context:%' BEGIN SELECT RAISE(ABORT, 'fixture write error'); END`);
      try {
        await submit('/compact remember the decision');
      } finally {
        db.exec('DROP TRIGGER fail_context_write');
      }
    } else {
      await submit('/compact remember the decision');
    }
    const [first] = await readTrajectory(
      harness.fetch(`${origin}/api/conversations/${id}/trajectory`),
    );
    expect(first.records.some(({ kind }) => kind === 'context')).toBe(
      reason !== 'trajectory write failure',
    );
    for (let index = 0; index < 4; index++) {
      await submit(`Seed ${index}: ${'work '.repeat(4_000)}`);
    }
    const compactionReason = reason === 'threshold' ? reason : 'overflow';
    await submit(compactionReason === 'threshold' ? 'Trigger threshold' : 'Trigger overflow');
    if (reason === 'threshold') {
      await harness.restart();
      await submit('Continue after restart.');
    }
    const path = `${origin}/api/conversations/${id}/trajectory`;
    const turns = await readTrajectory(harness.fetch(path));
    const compaction = turns
      .flatMap(({ records }) => records)
      .find((record) => record.kind === 'compaction' && record.reason === compactionReason);
    assert(compaction?.kind === 'compaction');
    expect(compaction.status).toBe('completed');
    const turn = turns.at(-1);
    const model = turn?.records.findLast(
      (record) => record.kind === 'assistant' && record.purpose === 'agent',
    );
    assert(turn && model);
    const response = await harness.fetch(`${path}/${turn.id}/${model.id}`);
    const input = trajectoryModelInputResponseSchema.parse(await response.json());
    expect(JSON.stringify(input.messages).split(marker)).toHaveLength(2);
    expect(JSON.stringify(input.messages)).toContain(checkpoint);
  },
);

test('an activation cancelled before the model request cannot displace an applied skill', async (context) => {
  const harness = await setupHarness(context, [], undefined, () => compactionProvider());
  for (const name of ['applied', 'cancelled']) {
    const directory = join(dirname(harness.databasePath), 'skills', name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Keep a decision\n---\n\nRULE_${name} ${'a'.repeat(18_000)}\n`,
    );
  }
  const workspace = await harness.prepareWorkspace();
  const { id } = await harness.create(
    workspace.id,
    (await harness.createPreset([agentSkillsCapabilityId])).id,
  );
  const client = harness.sdk(id);

  const submit = async (body: string) =>
    client.wait(await client.send({ message: { kind: 'user', body } }), {
      signal: AbortSignal.timeout(5000),
    });

  await submit('/applied Keep the first instructions');
  for (let index = 0; index < 4; index++) {
    await submit(`Seed ${index}: ${'work '.repeat(4_000)}`);
  }

  const reachedProvider = deferred();
  const release = deferred();
  const removeInstrumentation = instrument({
    observe() {},
    dispose() {},
    async interceptor(operation, _, next) {
      if (operation.type !== 'model') {
        return next();
      }
      reachedProvider.resolve();
      await release.promise;
      throw new DOMException('Interrupted before provider request', 'AbortError');
    },
  });
  try {
    const receipt = await client.send({
      message: { kind: 'user', body: '/cancelled Do not apply' },
    });
    const result = client.wait(receipt, { signal: AbortSignal.timeout(5000) }).then(
      () => undefined,
      (error: unknown) => error,
    );
    await Promise.race([reachedProvider.promise, result]);
    try {
      expect((await client.abort()).aborted).toBe(true);
    } finally {
      release.resolve();
    }
    expect(await result).toMatchObject({ failure: 'aborted' });
  } finally {
    await removeInstrumentation();
  }

  await submit('Trigger overflow');
  const path = `${origin}/api/conversations/${id}/trajectory`;
  const turn = (await readTrajectory(harness.fetch(path))).at(-1);
  const model = turn?.records.findLast(
    (record) => record.kind === 'assistant' && record.purpose === 'agent',
  );
  assert(turn && model);
  const input = trajectoryModelInputResponseSchema.parse(
    await (await harness.fetch(`${path}/${turn.id}/${model.id}`)).json(),
  );
  expect(JSON.stringify(input.messages)).toContain(checkpoint);
  expect(JSON.stringify(input.messages)).toContain('RULE_applied');
  expect(JSON.stringify(input.messages)).not.toContain('RULE_cancelled');
});

test.for(['user before eviction', 'user after eviction', 'model after eviction'] as const)(
  'restores the most recently reused skill (%s)',
  async (scenario, context) => {
    let providerInput = '';
    const toolPrompt = JSON.stringify({ tool: 'skill', name: 'first' });
    const harness = await setupHarness(context, [], undefined, () => {
      const provider = compactionProvider();
      const toolProvider = fixtureProvider([]);
      return {
        ...provider,
        streamSimple(model, input, options) {
          providerInput = JSON.stringify(input.messages);
          const user = input.messages.findLast(({ role }) => role === 'user');
          return user && JSON.stringify(user.content).includes(JSON.stringify(toolPrompt))
            ? toolProvider.streamSimple(model, input, options)
            : provider.streamSimple(model, input, options);
        },
      };
    });
    for (const name of ['first', 'second', 'third']) {
      const directory = join(dirname(harness.databasePath), 'skills', name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, 'SKILL.md'),
        `---\nname: ${name}\ndescription: Keep a decision\n---\n\nRULE_${name} ${'a'.repeat(12_000)}\n`,
      );
    }
    const workspace = await harness.prepareWorkspace();
    const { id } = await harness.create(
      workspace.id,
      (await harness.createPreset([agentSkillsCapabilityId])).id,
    );
    const client = harness.sdk(id);

    const submit = async (body: string) =>
      client.wait(await client.send({ message: { kind: 'user', body } }), {
        signal: AbortSignal.timeout(5_000),
      });

    const reuseBeforeEviction = scenario === 'user before eviction';
    const toolReuse = scenario === 'model after eviction';
    const order = reuseBeforeEviction
      ? ['first', 'second', 'first', 'third']
      : ['first', 'second', 'third'];
    for (const name of order) {
      await submit(`/${name} keep this workflow`);
    }
    if (!reuseBeforeEviction) {
      await submit(toolReuse ? toolPrompt : '/first reuse this workflow');
    }
    expect(providerInput.match(/RULE_first/g)).toHaveLength(1);
    if (toolReuse) {
      assert(providerInput.includes('Loaded skill: first.'));
    }
    for (let index = 0; index < 4; index++) {
      await submit(`Seed ${index}: ${'work '.repeat(4_000)}`);
    }
    await submit('Trigger overflow');
    const path = `${origin}/api/conversations/${id}/trajectory`;
    const turn = (await readTrajectory(harness.fetch(path))).at(-1);
    const model = turn?.records.findLast(
      (record) => record.kind === 'assistant' && record.purpose === 'agent',
    );
    assert(turn && model);
    const input = trajectoryModelInputResponseSchema.parse(
      await (await harness.fetch(`${path}/${turn.id}/${model.id}`)).json(),
    );
    for (const prompt of [providerInput, JSON.stringify(input.messages)]) {
      expect(prompt).toContain(checkpoint);
      expect(prompt.match(/RULE_first/g)).toHaveLength(1);
      expect(prompt.match(/RULE_third/g)).toHaveLength(1);
      expect(prompt).not.toContain('RULE_second');
    }
  },
);

test.for(['joined user message', 'newer skill in the same batch'] as const)(
  'restores skills in last-use order with a %s',
  { timeout: 30_000 },
  async (scenario, context) => {
    const joined = scenario === 'joined user message';
    const runTools = 'Use the requested skills';
    const followUp = 'One more thing for this response';
    const inputs: string[] = [];
    const harness = await setupHarness(context, [], undefined, () => {
      const provider = compactionProvider();
      let called = false;

      const streamSimple: Provider['streamSimple'] = (model, input, options) => {
        const prompt = JSON.stringify(input.messages);
        inputs.push(prompt);
        if (called || !prompt.includes(runTools)) {
          return provider.streamSimple(model, input, options);
        }
        called = true;
        const calls: ToolCall[] = (joined ? ['first'] : ['first', 'second']).map((name) => ({
          type: 'toolCall',
          id: `load-${name}`,
          name: 'skill',
          arguments: { name },
        }));
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
      };

      return { ...provider, stream: (model, input) => streamSimple(model, input), streamSimple };
    });
    for (const name of joined ? ['first', 'second', 'third'] : ['first', 'second']) {
      const directory = join(dirname(harness.databasePath), 'skills', name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, 'SKILL.md'),
        `---\nname: ${name}\ndescription: Keep a decision\n---\n\nRULE_${name} ${'a'.repeat(joined ? 12_000 : 18_000)}\n`,
      );
    }
    const workspace = await harness.prepareWorkspace();
    const { id } = await harness.create(
      workspace.id,
      (await harness.createPreset([agentSkillsCapabilityId])).id,
    );
    const client = harness.sdk(id);

    const send = (body: string) => client.send({ message: { kind: 'user', body } });

    const wait = (receipt: Awaited<ReturnType<typeof send>>) =>
      client.wait(receipt, { signal: AbortSignal.timeout(10_000) });

    const submit = async (body: string) => wait(await send(body));

    await submit('/first Keep this workflow');
    if (joined) {
      await submit('/second Keep this workflow');
    }

    const firstLoaded = deferred();
    const releaseFirst = deferred();
    const dispose = instrument({
      observe() {},
      dispose() {},
      async interceptor(operation, _, next) {
        if (operation.type !== 'tool') {
          return next();
        }
        if (operation.toolCallId === 'load-second') {
          await firstLoaded.promise;
          return next();
        }
        const result = await next();
        if (operation.toolCallId === 'load-first') {
          firstLoaded.resolve();
          if (joined) {
            await releaseFirst.promise;
          }
        }
        return result;
      },
    });
    try {
      const reply = wait(await send(runTools));
      try {
        if (joined) {
          await Promise.race([firstLoaded.promise, reply]);
          const followUpReceipt = await send(followUp);
          releaseFirst.resolve();
          await wait(followUpReceipt);
        }
      } finally {
        releaseFirst.resolve();
        await reply;
      }
    } finally {
      firstLoaded.resolve();
      await dispose();
    }
    const afterTools = inputs.at(-1);
    assert(afterTools);
    expect(afterTools).toContain('Loaded skill: first.');
    expect(afterTools).toContain(joined ? followUp : 'Loaded skill: second.');

    if (joined) {
      await submit('/third Keep this workflow');
    }
    for (let index = 0; index < 4; index++) {
      await submit(`Seed ${index}: ${'work '.repeat(4_000)}`);
    }
    await submit('Trigger overflow');
    const path = `${origin}/api/conversations/${id}/trajectory`;
    const turn = (await readTrajectory(harness.fetch(path))).at(-1);
    const model = turn?.records.findLast(
      (record) => record.kind === 'assistant' && record.purpose === 'agent',
    );
    assert(turn && model);
    const input = trajectoryModelInputResponseSchema.parse(
      await (await harness.fetch(`${path}/${turn.id}/${model.id}`)).json(),
    );
    for (const prompt of [inputs.at(-1), JSON.stringify(input.messages)]) {
      assert(prompt);
      expect(prompt).toContain(checkpoint);
      expect(prompt.match(/RULE_\w+/g)?.sort()).toEqual(
        joined ? ['RULE_first', 'RULE_third'] : ['RULE_second'],
      );
    }
  },
);

test('does not restore older instructions after a larger version of the same skill was used', async (context) => {
  const harness = await setupHarness(context, [], undefined, () => compactionProvider());
  const directory = join(dirname(harness.databasePath), 'skills', 'review');
  await mkdir(directory, { recursive: true });

  const skillFile = join(directory, 'SKILL.md');
  const header = '---\nname: review\ndescription: Review a change\n---\n\n';
  await writeFile(skillFile, header + 'ORIGINAL_REVIEW_RULE');

  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset([agentSkillsCapabilityId]);
  const { id } = await harness.create(workspace.id, preset.id);
  const client = harness.sdk(id);

  const submit = async (body: string) =>
    client.wait(await client.send({ message: { kind: 'user', body } }), {
      signal: AbortSignal.timeout(5_000),
    });

  await submit('/review Use the original instructions');
  await writeFile(skillFile, header + 'UPDATED_REVIEW_RULE ' + 'a'.repeat(34_000));
  await submit('/review Use the updated instructions');
  for (let index = 0; index < 4; index++) {
    await submit(`Seed ${index}: ${'work '.repeat(4_000)}`);
  }
  await submit('Trigger overflow');

  const path = `${origin}/api/conversations/${id}/trajectory`;
  const turns = await readTrajectory(harness.fetch(path));
  const updatedTurn = turns[1];
  const applied = updatedTurn.records.find(
    (record) => record.kind === 'context' && record.skill?.name === 'review',
  );
  assert(applied?.kind === 'context');
  expect(applied.body).toContain('UPDATED_REVIEW_RULE');

  const compacted = turns.at(-1);
  const final = compacted?.records.findLast(
    (record) => record.kind === 'assistant' && record.purpose === 'agent',
  );
  assert(compacted && final);
  const input = trajectoryModelInputResponseSchema.parse(
    await (await harness.fetch(`${path}/${compacted.id}/${final.id}`)).json(),
  );
  const messages = JSON.stringify(input.messages);
  expect(messages).toContain(checkpoint);
  expect(messages.includes('ORIGINAL_REVIEW_RULE')).toBe(false);
  expect(messages.includes('UPDATED_REVIEW_RULE')).toBe(false);
});

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
