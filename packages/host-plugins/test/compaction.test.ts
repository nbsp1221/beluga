import assert from 'node:assert/strict';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type AssistantMessage,
  type Provider,
  type ToolCall,
  createAssistantMessageEventStream,
} from '@earendil-works/pi-ai';
import { instrument, useAgentStart, useDelivery, useDispatchMessage } from '@flue/runtime';
import {
  agentSkillsCapabilityId,
  conversationUsageSchema,
  trajectoryModelInputResponseSchema,
} from '@workspace/protocol/host';
import { expect, test, vi } from 'vitest';
import type { AgentCapability, AgentCapabilityPlugin } from '../src/agent-capabilities/host.js';
import { origin, readTrajectory, setupHarness } from './fixtures/harness.js';
import { fixtureProvider } from './fixtures/model-provider.js';

const checkpoint = 'Keep the original decision to use port 4173.';

declare module '@workspace/runtime' {
  interface Services {
    fixtureSignal: AgentCapability;
  }
}

function signalCapability(
  capture: (dispatch: ReturnType<typeof useDispatchMessage>) => void,
  clearShadow?: () => Promise<void>,
): AgentCapabilityPlugin {
  return {
    service: 'fixtureSignal',
    plugin: {
      id: 'fixture-signal',
      provides: ['fixtureSignal'],
      setup(context) {
        context.provide('fixtureSignal', {
          metadata: {
            id: 'fixture-signal',
            name: 'Fixture signal',
            description: 'Send a test signal.',
          },
          useContext() {
            capture(useDispatchMessage());
            const delivery = useDelivery();
            useAgentStart(async () => {
              if (delivery.kind === 'signal' && delivery.type === 'clear-skill-shadow') {
                await clearShadow?.();
              }
            });
            return {};
          },
        });
      },
    },
  };
}

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

test.for([
  'joined user message',
  'newer skill in the same batch',
  'removed skill and a joined message',
  'joined message in a response started by a signal',
  'temporarily shadowed skill in the same tool batch',
] as const)(
  'restores skills in last-use order with a %s',
  { timeout: 30_000 },
  async (scenario, context) => {
    const removed = scenario === 'removed skill and a joined message';
    const fromSignal = scenario === 'joined message in a response started by a signal';
    const temporaryShadow = scenario === 'temporarily shadowed skill in the same tool batch';
    const joined = scenario !== 'newer skill in the same batch';
    const useBoth = !joined || temporaryShadow;
    const runTools = 'Use the requested skills';
    const followUp = 'One more thing for this response';
    const inputs: string[] = [];
    let dispatchSignal: ReturnType<typeof useDispatchMessage> | undefined;
    let shadowPath: string;
    const capabilities =
      fromSignal || temporaryShadow
        ? [
            signalCapability(
              (dispatch) => {
                dispatchSignal = dispatch;
              },
              temporaryShadow ? () => rm(shadowPath) : undefined,
            ),
          ]
        : [];
    const harness = await setupHarness(context, capabilities, undefined, () => {
      const provider = compactionProvider();
      let called = false;

      const streamSimple: Provider['streamSimple'] = (model, input, options) => {
        const prompt = JSON.stringify(input.messages);
        inputs.push(prompt);
        if (called || !prompt.includes(runTools)) {
          return provider.streamSimple(model, input, options);
        }
        called = true;
        const calls: ToolCall[] = (useBoth ? ['first', 'second'] : ['first']).map((name) => ({
          type: 'toolCall',
          id: `load-${name}`,
          name: 'skill',
          arguments: { name },
        }));
        return toolResponse(model, calls);
      };

      return { ...provider, stream: (model, input) => streamSimple(model, input), streamSimple };
    });
    const skills = join(dirname(harness.databasePath), 'skills');
    const keepThird = joined && !removed && !temporaryShadow;
    for (const name of keepThird ? ['first', 'second', 'third'] : ['first', 'second']) {
      const directory = join(skills, name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, 'SKILL.md'),
        `---\nname: ${name}\ndescription: Keep a decision\n---\n\nRULE_${name} ${'a'.repeat(keepThird ? 12_000 : 18_000)}\n`,
      );
    }
    const workspace = await harness.prepareWorkspace();
    shadowPath = join(harness.project, '.agents', 'skills', 'second', 'SKILL.md');
    const { id } = await harness.create(
      workspace.id,
      (
        await harness.createPreset([
          agentSkillsCapabilityId,
          ...(capabilities.length ? ['fixture-signal'] : []),
        ])
      ).id,
    );
    const client = harness.sdk(id);

    const send = (body: string) => client.send({ message: { kind: 'user', body } });

    const wait = (receipt: Awaited<ReturnType<typeof send>>) =>
      client.wait(receipt, { signal: AbortSignal.timeout(10_000) });

    const submit = async (body: string) => wait(await send(body));

    await submit('/first Keep this workflow');
    if (joined && !temporaryShadow) {
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
          if (temporaryShadow) {
            await releaseFirst.promise;
          }
          const result = await next();
          if (temporaryShadow) {
            await mkdir(dirname(shadowPath), { recursive: true });
            await writeFile(
              shadowPath,
              '---\nname: second\ndescription: Temporary override\n---\n\nShadow',
            );
          }
          return result;
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
      const run = async () => {
        if (!fromSignal) {
          return wait(await send(runTools));
        }
        assert(dispatchSignal);
        const receipt = await dispatchSignal({ kind: 'signal', type: 'fixture', body: runTools });
        await client.read(receipt.submissionId, { signal: AbortSignal.timeout(10_000) });
      };

      const reply = run();
      try {
        if (joined) {
          await Promise.race([firstLoaded.promise, reply]);
          if (removed) {
            await rm(join(skills, 'first'), { recursive: true });
          }
          const followUpReceipt = await send(followUp);
          if (temporaryShadow) {
            assert(dispatchSignal);
            await dispatchSignal({
              kind: 'signal',
              type: 'clear-skill-shadow',
              body: 'Remove the temporary override',
            });
          }
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
    const expectedMessages = [
      ...(joined ? [followUp] : []),
      ...(useBoth ? ['Loaded skill: second.'] : []),
    ];
    for (const message of expectedMessages) {
      expect(afterTools).toContain(message);
    }

    if (keepThird) {
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
        keepThird ? ['RULE_first', 'RULE_third'] : ['RULE_second'],
      );
    }
  },
);

test.for([
  'selected skill before the first model call',
  'tool result before the batch commits',
  'reused call ID with an interrupted result',
  'reused call ID with an interrupted result after switching models',
] as const)(
  'restores skills after resuming an interrupted response with a %s',
  { timeout: 30_000 },
  async (boundary, context) => {
    const switchModels =
      boundary === 'reused call ID with an interrupted result after switching models';
    const reusedCallId = boundary === 'reused call ID with an interrupted result' || switchModels;
    const fromTool = boundary !== 'selected skill before the first model call';
    const trigger = 'Apply the review skill';
    const prime = 'Use the original review skill';
    const skillOnResume = reusedCallId ? 'interrupted' : 'review';
    const snapshotAfter = reusedCallId ? 'snapshot-sibling' : 'load-review';
    const inputs: string[] = [];
    const harness = await setupHarness(context, [], undefined, () => {
      const provider = compactionProvider(undefined, switchModels ? 16_000 : undefined);

      const streamSimple: Provider['streamSimple'] = (model, input, options) => {
        const prompt = JSON.stringify(input.messages);
        inputs.push(prompt);
        const requested = input.messages.findLast(
          (message) =>
            message.role === 'user' && JSON.stringify(message.content).includes(`"${trigger}"`),
        );

        const hasRequest = (name: string) =>
          input.messages.some(
            (message) =>
              message.role === 'assistant' &&
              message.content.some(
                (part) => part.type === 'toolCall' && part.arguments.name === name,
              ),
          );

        if (reusedCallId && prompt.includes(`"${prime}"`) && !hasRequest('review')) {
          return toolResponse(model, [
            { type: 'toolCall', id: 'load-review', name: 'skill', arguments: { name: 'review' } },
          ]);
        }
        if (fromTool && requested && !hasRequest(skillOnResume)) {
          return toolResponse(model, [
            {
              type: 'toolCall',
              id: 'load-review',
              name: 'skill',
              arguments: { name: skillOnResume },
            },
            {
              type: 'toolCall',
              id: 'snapshot-sibling',
              name: 'skill',
              arguments: { name: 'missing' },
            },
          ]);
        }
        return provider.streamSimple(model, input, options);
      };

      return { ...provider, stream: (model, input) => streamSimple(model, input), streamSimple };
    });
    const directory = join(dirname(harness.databasePath), 'skills', 'review');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'SKILL.md'),
      `---\nname: review\ndescription: Review a change\n---\n\nRECOVERED_SKILL_RULE ${reusedCallId ? 'a'.repeat(18_000) : ''}\n`,
    );
    if (reusedCallId) {
      const interrupted = join(dirname(directory), 'interrupted');
      await mkdir(interrupted);
      await writeFile(
        join(interrupted, 'SKILL.md'),
        `---\nname: interrupted\ndescription: Keep a decision\n---\n\nINTERRUPTED_SKILL_RULE ${'a'.repeat(18_000)}\n`,
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

    const selectModel = async (model: string) => {
      const response = await harness.fetch(`${origin}/api/conversations/${id}/run-settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, effort: 'default' }),
      });
      expect(response.status).toBe(200);
    };

    if (reusedCallId) {
      await wait(await send(prime));
      assert(inputs.at(-1)?.includes('Loaded skill: review.'));
    }
    if (switchModels) {
      await selectModel('test-read/alternate');
    }

    const snapshot = `${harness.databasePath}.snapshot`;
    let captured = false;

    const capture = () => {
      using db = new DatabaseSync(harness.databasePath);
      db.prepare('VACUUM INTO ?').run(snapshot);
      captured = true;
    };

    const releaseTool = deferred();
    const interruptedLoaded = deferred();
    const dispose = instrument({
      observe() {},
      dispose() {},
      async interceptor(operation, _, next) {
        if (fromTool && operation.type === 'tool') {
          if (reusedCallId && operation.toolCallId === 'load-review') {
            const outcome = await next();
            interruptedLoaded.resolve();
            await releaseTool.promise;
            return outcome;
          }
          if (operation.toolCallId === 'snapshot-sibling') {
            await (reusedCallId ? interruptedLoaded.promise : releaseTool.promise);
          }
        }
        if (!fromTool && operation.type === 'model' && !captured) {
          capture();
        }
        return next();
      },
    });
    let receipt: Awaited<ReturnType<typeof send>>;
    try {
      receipt = await send(fromTool ? trigger : `/review ${trigger}`);
      const original = wait(receipt);
      try {
        if (fromTool) {
          using db = new DatabaseSync(harness.databasePath, { readOnly: true });
          const toolOutcome = db.prepare(`
            SELECT 1 FROM flue_conversation_stream_batches
            WHERE instr(data, '"type":"tool_outcome"') AND instr(data, ?)
          `);
          await vi.waitFor(() => assert(toolOutcome.get(`"toolCallId":"${snapshotAfter}"`)), {
            timeout: 5_000,
          });
          capture();
        }
      } finally {
        interruptedLoaded.resolve();
        releaseTool.resolve();
        await original;
      }
    } finally {
      await dispose();
    }
    assert(captured);

    await harness.getRuntime().dispose();
    await copyFile(snapshot, harness.databasePath);
    {
      using db = new DatabaseSync(harness.databasePath);
      // Simulate the expired lease of the stopped worker without waiting for its real deadline.
      assert.equal(
        db
          .prepare(
            "UPDATE flue_agent_submissions SET lease_expires_at = 1 WHERE status = 'running'",
          )
          .run().changes,
        1,
      );
    }
    const resumeAt = inputs.length;
    await harness.restart();
    await wait(receipt);
    const resumed = inputs
      .slice(resumeAt)
      .find((prompt) => prompt.includes('RECOVERED_SKILL_RULE'));
    assert(resumed);
    if (fromTool) {
      assert(resumed.includes('Loaded skill: review.'));
    }
    if (reusedCallId) {
      assert(resumed.includes('INTERRUPTED_SKILL_RULE'));
      assert(resumed.includes('Tool execution was interrupted before completion.'));
    }
    if (switchModels) {
      await selectModel('test-read/fixture');
    }
    for (let index = 0; index < 4; index++) {
      await wait(await send(`Seed ${index}: ${'work '.repeat(4_000)}`));
    }
    await wait(await send('Trigger overflow'));
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
      expect(prompt.match(/RECOVERED_SKILL_RULE/g)).toHaveLength(1);
      expect(prompt).not.toContain('INTERRUPTED_SKILL_RULE');
    }
  },
);

test(
  'remembers skills used after overflow summarizes their tool results',
  { timeout: 30_000 },
  async (context) => {
    const inputs: string[] = [];
    const names = ['first', 'second'];
    const trigger = 'Trigger overflow after loading skills';
    const harness = await setupHarness(context, [], undefined, () => {
      const provider = compactionProvider();
      let called = false;

      const streamSimple: Provider['streamSimple'] = (model, input, options) => {
        const prompt = JSON.stringify(input.messages);
        inputs.push(prompt);
        if (!called && prompt.includes(trigger)) {
          called = true;
          return toolResponse(
            model,
            names.map((name) => ({
              type: 'toolCall',
              id: `load-${name}`,
              name: 'skill',
              arguments: { name },
            })),
          );
        }
        return provider.streamSimple(model, input, options);
      };

      return { ...provider, stream: (model, input) => streamSimple(model, input), streamSimple };
    });
    for (const name of names) {
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
        signal: AbortSignal.timeout(10_000),
      });

    await submit(`Seed: ${'work '.repeat(4_000)}`);
    await submit(trigger);
    const retried = inputs.at(-1);
    assert(retried);
    expect(retried).toContain(checkpoint);
    expect(retried).not.toContain('"role":"toolResult"');
    expect(retried.match(/RULE_\w+/g)?.sort()).toEqual(['RULE_first', 'RULE_second']);

    for (let index = 0; index < 4; index++) {
      await submit(`Seed ${index}: ${'work '.repeat(4_000)}`);
    }
    await submit('Trigger threshold');
    await submit('Inspect restored skills');
    const path = `${origin}/api/conversations/${id}/trajectory`;
    const turn = (await readTrajectory(harness.fetch(path))).at(-1);
    const model = turn?.records.findLast(
      (record) => record.kind === 'assistant' && record.purpose === 'agent',
    );
    assert(turn && model);
    const input = trajectoryModelInputResponseSchema.parse(
      await (await harness.fetch(`${path}/${turn.id}/${model.id}`)).json(),
    );
    const restored = inputs.at(-1)?.match(/RULE_\w+/g);
    expect(restored).toHaveLength(1);
    expect(JSON.stringify(input.messages).match(/RULE_\w+/g)).toEqual(restored);
  },
);

test.for([
  { scenario: 'restores a skill delivered in a separate response', replacement: undefined },
  {
    scenario: 'restores the updated selection over a delayed signal',
    replacement: 'UPDATED_SKILL_RULE',
  },
  {
    scenario: 'keeps unrelated bodies that fit alongside the updated selection',
    replacement: 'UPDATED_SKILL_RULE',
    preload: true,
  },
])(
  '$scenario after a joined submission fails',
  { timeout: 30_000 },
  async ({ replacement, preload }, context) => {
    const marker = 'DELAYED_SKILL_RULE';
    const trigger = 'Load the review skill';
    const inputs: string[] = [];
    const harness = await setupHarness(context, [], undefined, () => {
      const provider = compactionProvider();
      let called = false;

      const streamSimple: Provider['streamSimple'] = (model, input, options) => {
        const prompt = JSON.stringify(input.messages);
        inputs.push(prompt);
        if (!called && prompt.includes(trigger)) {
          called = true;
          return toolResponse(model, [
            { type: 'toolCall', id: 'load-review', name: 'skill', arguments: { name: 'review' } },
          ]);
        }
        return provider.streamSimple(model, input, options);
      };

      return { ...provider, stream: (model, input) => streamSimple(model, input), streamSimple };
    });
    const root = join(dirname(harness.databasePath), 'skills');
    const reviewPath = join(root, 'review', 'SKILL.md');

    const skillFile = (name: string, body: string) =>
      `---\nname: ${name}\ndescription: Review a change\n---\n\n${body}\n`;

    const previousSkills = preload ? ['alpha', 'beta'] : [];
    for (const [name, body] of [
      ['review', preload ? `${marker} ${'a'.repeat(18_000)}` : marker],
      ['too-large', 'a'.repeat(1024 * 1024)],
      ...previousSkills.map((name) => [name, `KEEP_${name} ${'a'.repeat(12_000)}`]),
    ]) {
      const directory = join(root, name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'SKILL.md'), skillFile(name, body));
    }
    const workspace = await harness.prepareWorkspace();
    const preset = await harness.createPreset([agentSkillsCapabilityId]);
    const { id } = await harness.create(workspace.id, preset.id);
    const client = harness.sdk(id);

    const send = (body: string) => client.send({ message: { kind: 'user', body } });

    const wait = (receipt: Awaited<ReturnType<typeof send>>) =>
      client.wait(receipt, { signal: AbortSignal.timeout(10_000) });

    for (const name of previousSkills) {
      await wait(await send(`/${name} Keep these instructions`));
    }

    const toolStarted = deferred();
    const allowTool = deferred();
    let receivingSubmissionId: string | null = null;
    const dispose = instrument({
      observe() {},
      dispose() {},
      async interceptor(operation, _, next) {
        if (operation.type === 'tool' && operation.toolCallId === 'load-review') {
          toolStarted.resolve();
          await allowTool.promise;
          const result = await next();
          if (replacement) {
            await writeFile(reviewPath, skillFile('review', replacement));
          }
          return result;
        }
        return next();
      },
    });
    try {
      const original = await send(trigger);
      const settled = wait(original).catch((error: unknown) => error);
      try {
        await Promise.race([toolStarted.promise, settled]);
        const invalid = await send('/too-large fail before the skill signal arrives');
        const updated = replacement ? await send('/review Use the current skill') : undefined;
        allowTool.resolve();
        await expect(wait(invalid)).rejects.toMatchObject({ failure: 'failed' });
        if (updated) {
          await wait(updated);
          receivingSubmissionId = updated.submissionId;
        }
      } finally {
        allowTool.resolve();
        await settled;
      }
    } finally {
      await dispose();
    }
    using db = new DatabaseSync(harness.databasePath, { readOnly: true });
    const signalResponse = db.prepare(`
    SELECT submission_id, joined_into, error FROM flue_agent_submissions
    WHERE kind = 'dispatch' AND status = 'settled' AND instr(payload, ?) > 0
  `);
    const delivery = await vi.waitFor(
      () => {
        const row = signalResponse.get(marker);
        assert(row);
        return row;
      },
      { timeout: 10_000 },
    );
    expect(delivery).toMatchObject({
      joined_into: receivingSubmissionId,
      error: null,
    });
    const applied = inputs.find((prompt) => prompt.includes(marker));
    assert(applied);
    expect(applied).toContain('Loaded skill: review.');
    expect(applied.match(/(?:DELAYED|UPDATED)_SKILL_RULE/g)?.sort()).toEqual(
      replacement ? [marker, replacement] : [marker],
    );

    for (let index = 0; index < 4; index++) {
      await wait(await send(`Seed ${index}: ${'work '.repeat(4_000)}`));
    }
    await wait(await send('Trigger overflow'));
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
      expect(prompt.match(/(?:DELAYED|UPDATED)_SKILL_RULE/g)).toEqual([replacement ?? marker]);
      expect(prompt.match(/KEEP_\w+/g)?.sort() ?? []).toEqual(
        previousSkills.map((name) => `KEEP_${name}`),
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
