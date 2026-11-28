import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type AssistantMessage,
  type Provider,
  type ToolCall,
  createAssistantMessageEventStream,
} from '@earendil-works/pi-ai';
import { instrument } from '@flue/runtime';
import { trajectoryModelInputResponseSchema } from '@workspace/protocol/host';
import * as v from 'valibot';
import { type TestContext, expect, test, vi } from 'vitest';
import { allCapabilities, origin, readTrajectory, setupHarness } from './fixtures/harness.js';
import { fixtureProvider } from './fixtures/model-provider.js';

const v1 = 'AUDIT_PROJECT_RULE_V1';
const v2 = 'AUDIT_PROJECT_RULE_V2';
const nested = 'AUDIT_NESTED_RULE';
const checkpoint = 'AUDIT_COMPACTION_CHECKPOINT';

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const ruleVersions = (text: string) =>
  [...text.matchAll(/AUDIT_PROJECT_RULE_V[12]/g)].map(([value]) => value);

const encode = (value: unknown) => JSON.stringify(value);

type Mode = 'race' | 'overflow' | 'restart';

const userMessage = v.object({
  role: v.literal('user'),
  content: v.union([v.string(), v.array(v.object({ text: v.optional(v.string()) }))]),
});

function instructionSignals(messages: readonly unknown[]) {
  return messages.flatMap((message) => {
    const parsed = v.safeParse(userMessage, message);
    if (!parsed.success) {
      return [];
    }
    const { content } = parsed.output;
    const text = typeof content === 'string' ? content : content.map((part) => part.text).join('');
    return text.startsWith('<system-reminder type="agent-instructions"') ? [text] : [];
  });
}

type ModelInput = { messages: readonly unknown[]; summary: boolean };

function provider(inputs: ModelInput[], mode: Mode): Provider {
  const base = fixtureProvider([]);
  const model = base.getModels()[0];
  let called = false;
  let overflowed = false;
  let seeded = false;

  const streamSimple: Provider['streamSimple'] = (selected, context) => {
    const text = encode(context.messages);
    const summary = text.includes('<conversation>');
    inputs.push({ messages: context.messages, summary });
    const trigger = text.includes('AUDIT_RUN_TOOLS');
    const seed = mode === 'restart' && !seeded && text.includes('AUDIT_SEED_SCOPE');
    let tools: ToolCall[] = [];
    if (!summary && (seed || (trigger && !called))) {
      seeded ||= seed;
      called ||= trigger;
      tools = [
        {
          type: 'toolCall',
          id: seed ? 'seed-read' : 'audit-read',
          name: 'read',
          arguments: { path: 'docs/notes.txt' },
        },
      ];
      if (mode === 'race') {
        tools.push({
          type: 'toolCall',
          id: 'audit-edit',
          name: 'edit',
          arguments: { path: 'AGENTS.md', edits: [{ oldText: v1, newText: v2 }] },
        });
      }
      if (mode === 'restart' && !seed) {
        tools.push({
          type: 'toolCall',
          id: 'sibling-read',
          name: 'read',
          arguments: { path: 'README.md' },
        });
      }
    }
    const overflow =
      !summary && mode === 'overflow' && trigger && called && !tools.length && !overflowed;
    overflowed ||= overflow;
    const message: AssistantMessage = {
      role: 'assistant',
      content: tools.length
        ? tools
        : [{ type: 'text', text: summary ? checkpoint : 'Fixture complete.' }],
      api: selected.api,
      provider: selected.provider,
      model: selected.id,
      timestamp: Date.now(),
      stopReason: overflow ? 'error' : tools.length ? 'toolUse' : 'stop',
      usage: {
        input: 1_000,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 1_050,
        cost: { ...model.cost, total: 0 },
      },
    };
    const stream = createAssistantMessageEventStream();
    if (overflow) {
      stream.push({
        type: 'error',
        reason: 'error',
        error: { ...message, errorMessage: 'maximum context length exceeded' },
      });
    } else {
      stream.push({ type: 'start', partial: message });
      for (const [contentIndex, toolCall] of tools.entries()) {
        stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial: message });
      }
      stream.push({ type: 'done', reason: tools.length ? 'toolUse' : 'stop', message });
    }
    return stream;
  };

  return { ...base, stream: (selected, context) => streamSimple(selected, context), streamSimple };
}

async function setup(context: TestContext, mode: Mode) {
  const inputs: ModelInput[] = [];
  const modelProvider = provider(inputs, mode);
  const harness = await setupHarness(context, allCapabilities, undefined, () => modelProvider);
  const ruleFile = join(harness.project, 'AGENTS.md');
  const nestedFile = join(harness.project, 'docs', 'AGENTS.md');
  await writeFile(ruleFile, v1);
  await writeFile(nestedFile, nested);
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset(['file.read', 'file.write', 'agent-instructions']);
  const { id } = await harness.create(workspace.id, preset.id, 'workspace-write');
  const client = harness.sdk(id);
  const url = origin + '/api/conversations/' + id + '/trajectory';

  const send = (body: string) =>
    client.send({ message: { kind: 'user', body }, idempotencyKey: crypto.randomUUID() });

  const wait = (receipt: Awaited<ReturnType<typeof send>>) =>
    client.wait(receipt, { signal: AbortSignal.timeout(5_000) });

  const trajectory = () => readTrajectory(harness.fetch(url));

  const getInput = async (turnId: string, modelId: string) => {
    const response = await harness.fetch(url + '/' + turnId + '/' + modelId);
    expect(response.status).toBe(200);
    return trajectoryModelInputResponseSchema.parse(await response.json());
  };

  return { harness, inputs, ruleFile, nestedFile, client, send, wait, trajectory, getInput };
}

async function verifyLastModel(fixture: Awaited<ReturnType<typeof setup>>, submissionId?: string) {
  const turns = await fixture.trajectory();
  const turn = submissionId ? turns.find(({ id }) => id === submissionId) : turns.at(-1);
  assert(turn);
  const model = turn.records.findLast(
    (record) => record.kind === 'assistant' && record.purpose === 'agent',
  );
  assert(model?.kind === 'assistant');
  const input = await fixture.getInput(turn.id, model.id);
  const modelInput = fixture.inputs.findLast(({ summary }) => !summary);
  assert(modelInput);
  const modelText = encode(modelInput.messages);
  const traceText = encode(input.messages);
  const signals = instructionSignals(input.messages);
  expect(ruleVersions(traceText)).toEqual(ruleVersions(modelText));
  expect(signals).toEqual(instructionSignals(modelInput.messages));
  const contexts = turn.records.filter((record) => record.kind === 'context');
  return { turn, model, traceText, modelText, contexts, signals };
}

test.for([true, false])(
  'parallel read and edit while prior discovery is held=%s',
  async (editWhileHeld, context) => {
    const fixture = await setup(context, 'race');
    const { harness, ruleFile, nestedFile } = fixture;
    const files = harness.getRuntime().get('workspaceFiles');
    const originalRead = files.read;
    const snapshotHeld = latch();
    const staleReleased = latch();
    const readFinished = latch();
    const order: string[] = [];
    let rootSeen = '';
    files.read = async function* (target, options) {
      if (target.absolutePath === nestedFile && !order.includes('read-held')) {
        order.push('read-held');
        snapshotHeld.resolve();
        await staleReleased.promise;
      }
      const chunks: Uint8Array[] = [];
      for await (const data of originalRead(target, options)) {
        chunks.push(data);
        yield data;
      }
      if (target.absolutePath === ruleFile) {
        rootSeen = Buffer.concat(chunks).toString();
        order.push('rule:' + rootSeen);
      }
    };
    const dispose = instrument({
      observe() {},
      dispose() {},
      async interceptor(operation, _context, next) {
        if (operation.type === 'tool' && operation.toolName === 'edit') {
          await snapshotHeld.promise;
          if (!editWhileHeld) {
            await readFinished.promise;
          }
          const result = await next();
          order.push('edit-ended');
          staleReleased.resolve();
          return result;
        }
        const result = await next();
        if (operation.type === 'tool' && operation.toolName === 'read') {
          order.push('read-ended');
          readFinished.resolve();
        }
        return result;
      },
    });
    try {
      const settled = fixture.wait(await fixture.send('AUDIT_RUN_TOOLS'));
      try {
        await Promise.race([snapshotHeld.promise, settled]);
        if (editWhileHeld) {
          await vi.waitFor(async () => assert.equal(await readFile(ruleFile, 'utf8'), v2));
          order.push('disk-v2');
        }
      } finally {
        staleReleased.resolve();
      }
      await settled;
      expect(await readFile(ruleFile, 'utf8')).toBe(v2);
      expect(order.slice(0, 3)).toEqual(['rule:' + v1, 'rule:' + v1, 'read-held']);
      expect(order.filter((event) => event === 'disk-v2' || event === 'rule:' + v2)).toEqual(
        editWhileHeld ? ['disk-v2', 'rule:' + v2] : ['rule:' + v2],
      );
      expect(order.indexOf('read-ended')).toBeLessThan(order.indexOf('edit-ended'));
      expect(rootSeen).toBe(v2);
      const { model, traceText, contexts, turn, signals } = await verifyLastModel(fixture);
      const versions = signals.flatMap(ruleVersions);
      expect(versions).toEqual([v1, v2]);
      expect(traceText).toContain(nested);
      const changes = contexts.filter((record) => record.modelRequestId === model.id);
      expect(changes).toHaveLength(2);
      expect(changes.map(({ body }) => ruleVersions(body).at(-1))).toEqual([undefined, v2]);
      expect(
        turn.records.filter((record) => record.kind === 'tool').map(({ status }) => status),
      ).toEqual(['completed', 'completed']);
    } finally {
      snapshotHeld.resolve();
      staleReleased.resolve();
      readFinished.resolve();
      files.read = originalRead;
      await dispose();
    }
  },
);

test('restores only the missing scope on the overflow retry and in Trace', async (context) => {
  const fixture = await setup(context, 'overflow');
  for (let i = 0; i < 4; i++) {
    await fixture.wait(await fixture.send('Seed ' + i + ': ' + 'work '.repeat(4_000)));
  }
  await fixture.wait(await fixture.send('AUDIT_RUN_TOOLS'));
  const { turn, model, traceText, modelText, contexts, signals } = await verifyLastModel(fixture);
  expect(turn.records).toContainEqual(
    expect.objectContaining({ kind: 'compaction', status: 'completed', reason: 'overflow' }),
  );
  expect(model).toMatchObject({ status: 'completed', contextCompacted: true });
  expect(traceText).toContain(checkpoint);
  expect(modelText).toContain(checkpoint);
  expect(ruleVersions(modelText)).toEqual([v1]);
  expect(signals.filter((text) => text.includes(nested))).toHaveLength(1);
  expect(signals[0]).toContain(nested);
  expect(signals[1]).toContain(v1);
  expect(
    contexts.filter(({ modelRequestId }) => modelRequestId === model.id).map(({ text }) => text),
  ).toEqual(['AGENTS.md']);
});

test.for(['keep', 'edit', 'delete', 'unavailable'] as const)(
  'reconciles a retained instruction after a partial restart (%s file)',
  async (file, context) => {
    const fixture = await setup(context, 'restart');
    const { harness, nestedFile } = fixture;
    const replacement = 'AUDIT_CURRENT_DOCS_INSTRUCTIONS';
    const unavailable = file === 'unavailable';
    if (unavailable) {
      // Persist the older text before the interrupted read discovers its replacement.
      await fixture.wait(await fixture.send('AUDIT_SEED_SCOPE'));
      await writeFile(nestedFile, replacement);
    }
    const held = latch();
    const release = latch();
    const dispose = instrument({
      observe() {},
      dispose() {},
      async interceptor(operation, _context, next) {
        if (operation.type === 'tool' && operation.toolCallId === 'sibling-read') {
          held.resolve();
          await release.promise;
        }
        return next();
      },
    });
    const snapshot = join(dirname(harness.databasePath), 'interrupted.sqlite');
    let receipt: Awaited<ReturnType<typeof fixture.send>>;
    try {
      receipt = await fixture.send('AUDIT_RUN_TOOLS');
      const settled = fixture.client.wait(receipt, { signal: context.signal });
      try {
        await Promise.race([held.promise, settled]);
        const db = new DatabaseSync(harness.databasePath);
        try {
          await vi.waitFor(
            () => {
              const batches = db.prepare('SELECT data FROM flue_conversation_stream_batches').all();

              const hasOutcome = (id: string) =>
                batches.some(
                  ({ data }) =>
                    typeof data === 'string' &&
                    data.includes('"type":"tool_outcome"') &&
                    data.includes(`"toolCallId":"${id}"`),
                );

              expect(hasOutcome('audit-read')).toBe(true);
              expect(hasOutcome('sibling-read')).toBe(false);
              expect(encode(db.prepare('SELECT * FROM flue_agent_submissions').all())).toContain(
                unavailable ? replacement : nested,
              );
            },
            { timeout: 4_000 },
          );
          db.prepare('VACUUM INTO ?').run(snapshot);
        } finally {
          db.close();
        }
      } finally {
        release.resolve();
        await settled;
      }
    } finally {
      await dispose();
    }

    await harness.getRuntime().dispose();
    const db = new DatabaseSync(snapshot);
    try {
      // The replaced worker's lease must expire before another worker can recover its submission.
      expect(
        db
          .prepare(
            "UPDATE flue_agent_submissions SET lease_expires_at = ? WHERE status = 'running'",
          )
          .run(Date.now() - 1).changes,
      ).toBe(1);
    } finally {
      db.close();
    }
    await copyFile(snapshot, harness.databasePath);
    const deleted = file === 'delete';
    if (deleted) {
      await unlink(nestedFile);
    } else if (file === 'edit') {
      await writeFile(nestedFile, replacement);
    }
    expect(await readFile(nestedFile, 'utf8').catch(() => undefined)).toBe(
      deleted ? undefined : file === 'keep' ? nested : replacement,
    );
    await harness.restart();
    await fixture.client.wait(receipt, { signal: context.signal });

    const files = harness.getRuntime().get('workspaceFiles');
    const read = files.read;
    const readSpy = vi.spyOn(files, 'read').mockImplementation((target, options) => {
      if (unavailable && target.absolutePath === nestedFile) {
        throw new Error('Temporary permission failure reading saved instructions');
      }
      return read(target, options);
    });
    context.onTestFinished(() => {
      readSpy.mockRestore();
    });
    const followUp = await fixture.send('Continue after restart');
    await fixture.wait(followUp);

    const { model, signals, contexts } = await verifyLastModel(fixture, followUp.submissionId);
    const removal = 'Instructions removed: "docs/AGENTS.md"';
    const scopeChanges = contexts
      .filter(({ modelRequestId }) => modelRequestId === model.id)
      .flatMap(({ changes }) => changes)
      .filter(({ path }) => path === 'docs/AGENTS.md')
      .map(({ action }) => action);
    expect(signals.filter((text) => text.includes(nested))).toHaveLength(1);
    expect(signals.filter((text) => text.includes(replacement))).toHaveLength(
      file === 'edit' || unavailable ? 1 : 0,
    );
    expect(signals.filter((text) => text.includes(removal))).toHaveLength(deleted ? 1 : 0);
    expect(scopeChanges).toEqual(deleted ? ['remove'] : file === 'edit' ? ['replace'] : []);
  },
);

test('a held instruction update does not block a second conversation in the same workspace', async (context) => {
  const harness = await setupHarness(context, allCapabilities);
  const firstRule = join(harness.project, 'docs', 'AGENTS.md');
  const secondFolder = join(harness.project, 'other');
  await mkdir(secondFolder);
  await writeFile(firstRule, 'FIRST_CONVERSATION_RULE');
  await writeFile(join(secondFolder, 'AGENTS.md'), 'SECOND_CONVERSATION_RULE');
  await writeFile(join(secondFolder, 'notes.txt'), 'second conversation document');
  const workspace = await harness.prepareWorkspace();
  const preset = await harness.createPreset(['file.read', 'agent-instructions']);
  const first = await harness.create(workspace.id, preset.id);
  const second = await harness.create(workspace.id, preset.id);
  const files = harness.getRuntime().get('workspaceFiles');
  const originalRead = files.read;
  const held = latch();
  const release = latch();
  files.read = async function* (target, options) {
    if (target.absolutePath === firstRule) {
      held.resolve();
      await release.promise;
    }
    yield* originalRead(target, options);
  };

  const firstTurn = harness.turn(first.id, 'docs/notes.txt');
  try {
    await Promise.race([held.promise, firstTurn]);
    const [, input] = await harness.turn(second.id, 'other/notes.txt');
    expect(encode(input)).toContain('SECOND_CONVERSATION_RULE');
    expect(encode(input)).not.toContain('FIRST_CONVERSATION_RULE');
  } finally {
    release.resolve();
    files.read = originalRead;
    await firstTurn;
  }
  const firstTrace = await readTrajectory(
    harness.fetch(origin + '/api/conversations/' + first.id + '/trajectory'),
  );
  const contexts = firstTrace.at(-1)?.records.filter((record) => record.kind === 'context');
  expect(contexts?.map(({ text }) => text)).toEqual(['docs/AGENTS.md']);
});
