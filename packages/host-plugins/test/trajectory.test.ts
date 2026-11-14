import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TrajectoryRecord } from '@workspace/protocol/host';
import { Hono } from 'hono';
import { expect, test } from 'vitest';
import { mountTrajectoryRoutes } from '../src/trajectory/http.js';
import { createTrajectoryStore } from '../src/trajectory/store.js';

test('pages a long history, finds older matches, and skips unchanged responses', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createTrajectoryStore(db);
    for (let index = 1; index <= 210; index++) {
      const id = String(index);
      store.put('session', id, { id, kind: 'user', text: index === 3 ? '초기 설정' : 'Work' });
      store.put('session', id, { id: 'model', kind: 'assistant', text: '', status: 'completed' });
    }

    const first = store.page('session', undefined, '', 50);
    expect(first.requests.map(({ turn }) => turn)).toEqual(
      Array.from({ length: 50 }, (_, index) => 161 + index),
    );
    expect(first.before).not.toBeNull();
    const earlier = store.page('session', first.before ?? undefined, '', 50);
    expect(earlier.requests[0]?.turn).toBe(111);
    expect(earlier.requests.at(-1)?.turn).toBe(160);
    expect(store.page('session', undefined, '초기', 50).requests[0]?.turn).toBe(3);
    expect(store.page('session', undefined, 'request #32', 50).requests[0]).toMatchObject({
      turn: 32,
      precedingModelRequests: 31,
    });

    const app = new Hono();
    mountTrajectoryRoutes(
      app,
      (id) => id === 'session',
      store,
      () => undefined,
    );
    const url = '/api/conversations/session/trajectory';
    const response = await app.request(url);
    const tag = response.headers.get('etag');
    expect(response.status).toBe(200);
    expect(tag).toBeTruthy();
    const headers = { 'If-None-Match': tag ?? '' };
    expect((await app.request(url, { headers })).status).toBe(304);

    store.put('session', '210', { id: 'tool', kind: 'tool', name: 'read', status: 'completed' });
    expect((await app.request(url, { headers })).status).toBe(200);
  } finally {
    db.close();
  }
});

test('restores model inputs and only records initial or changed system prompts', async ({
  onTestFinished,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'beluga-trajectory-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));

  const path = join(root, 'trajectory.sqlite');
  const first = {
    systemPrompt: 'original',
    messages: [{ role: 'user', content: 'question' }],
    tools: [],
  };
  const second = {
    ...first,
    messages: [...first.messages, { role: 'toolResult', content: 'result' }, ...first.messages],
  };

  let messageIds: string[] | undefined;
  const db = new DatabaseSync(path);
  try {
    const store = createTrajectoryStore(db);
    const time = '2026-11-09T00:00:00Z';
    store.put('session', 'turn', {
      id: 'input:turn',
      kind: 'user',
      text: 'question',
    });
    store.putModelInput('session', 'turn', 'model:1', time, first);
    store.putModelInput('session', 'turn', 'model:2', time, second);
    store.putModelInput('session', 'turn', 'model:3', time, {
      ...second,
      systemPrompt: 'updated',
    });
    store.put('session', 'turn', {
      kind: 'assistant',
      id: 'model:2',
      text: '',
      status: 'completed',
      contextSample: { model: 'fixture', revision: 1, contextWindow: 1000, inputTokens: 200 },
    });
    messageIds = store.modelInput('session', 'turn', 'model:2')?.messageIds;
  } finally {
    db.close();
  }

  const reopenedDb = new DatabaseSync(path);
  try {
    const reopened = createTrajectoryStore(reopenedDb);
    const input = reopened.modelInput('session', 'turn', 'model:2');
    expect(messageIds).toHaveLength(second.messages.length);
    expect(new Set(messageIds).size).toBe(second.messages.length);
    expect(input).toEqual({ ...second, messageIds });
    expect(reopened.usage('session', { model: 'fixture', revision: 1 }).context).toEqual({
      status: 'available',
      model: 'fixture',
      contextWindow: 1000,
      inputTokens: 200,
      estimatedTokens: {
        systemPrompt: 2,
        tools: 0,
        messages: Math.ceil(
          second.messages.reduce(
            (bytes, message) => bytes + Buffer.byteLength(JSON.stringify(message)),
            0,
          ) / 4,
        ),
      },
    });
    expect(reopened.modelInput('another-session', 'turn', 'model:2')).toBe(undefined);
    expect(
      reopened
        .page('session', undefined, '', 1)
        .requests[0].request.records.filter((record) => record.kind !== 'assistant')
        .map((record) => ('text' in record ? record.text : undefined)),
    ).toEqual(['Initial System Prompt', 'question', 'System Prompt Updated']);
    expect(
      reopenedDb.prepare('SELECT COUNT(*) AS count FROM trajectory_input_content').get()?.count,
    ).toBe(5);
  } finally {
    reopenedDb.close();
  }
});

test('Trajectory records stay ordered and scoped to a session after updates', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createTrajectoryStore(db);
    const first = {
      id: 'model:1',
      kind: 'assistant',
      status: 'in-progress',
      text: '',
    } satisfies TrajectoryRecord;
    store.put('session', 'turn', first);
    store.put('session', 'turn', {
      id: 'tool:1',
      kind: 'tool',
      name: 'read',
      status: 'failed',
      error: 'File missing',
      durationMs: 100,
    });
    store.put('session', 'turn', {
      ...first,
      status: 'completed',
      timestamp: '2026-11-09T00:00:00Z',
      firstOutputAt: '2026-11-09T00:00:00.250Z',
      durationMs: 1250,
      usage: { totalTokens: 128, input: 36, output: 40, cacheRead: 32, cacheWrite: 20 },
    });
    store.put('session', 'turn', {
      id: 'input:turn',
      kind: 'user',
      text: 'Read the file',
    });
    store.settle('session', 'turn', 'completed', '2026-11-09T00:00:00Z');

    const [{ request: turn }] = createTrajectoryStore(db).page(
      'session',
      undefined,
      '',
      1,
    ).requests;
    expect(turn.records.map(({ id }) => id)).toEqual(['input:turn', 'model:1', 'tool:1']);
    expect(turn.records[2]).toMatchObject({ durationMs: 100, status: 'failed' });
    expect(turn.status).toBe('completed');
    expect(store.page('other', undefined, '', 1).requests).toEqual([]);

    store.put('session', 'second-turn', { ...first, status: 'interrupted' });
    store.put('other', 'turn', { ...first, usage: { totalTokens: 512 } });
    expect(store.usage('session')).toEqual({
      turns: 2,
      steps: 2,
      modelMs: 1250,
      toolMs: 100,
      averageFirstOutputMs: 250,
      outputTokensPerSecond: 40,
      tokens: 128,
      input: 36,
      output: 40,
      cacheRead: 32,
      cacheWrite: 20,
    });
    expect(store.usage('empty')).toEqual({
      turns: 0,
      steps: 0,
      modelMs: null,
      toolMs: null,
      averageFirstOutputMs: null,
      outputTokensPerSecond: null,
      tokens: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  } finally {
    db.close();
  }
});

test('Interruption ends unfinished records without changing completed steps', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createTrajectoryStore(db);
    store.put('session', 'turn', {
      id: 'model:1',
      kind: 'assistant',
      text: 'Partial output',
      status: 'completed',
    });
    store.put('session', 'turn', {
      id: 'tool:1',
      kind: 'tool',
      name: 'shell',
      status: 'in-progress',
    });

    store.settle('session', 'turn', 'interrupted', '2026-11-09T00:00:00Z');
    const [{ request: turn }] = store.page('session', undefined, '', 1).requests;
    expect(turn.records[0]).toMatchObject({ status: 'completed' });
    expect(turn.records[1]).toMatchObject({ status: 'interrupted' });
  } finally {
    db.close();
  }
});
