import type { FlueConversationMessage } from '@flue/sdk';
import { expect, test } from 'vitest';
import { conversationMessages } from '../src/features/conversation/data/flue-client.js';

test('Chat keeps visible assistant parts in order and distinguishes unfinished tool calls', () => {
  const assistant: FlueConversationMessage = {
    id: 'response',
    submissionId: 'submission',
    role: 'assistant',
    purpose: 'assistant',
    display: 'visible',
    parts: [
      { type: 'reasoning', text: '', state: 'done' },
      { type: 'reasoning', text: 'Plan', state: 'done' },
      { type: 'text', text: 'First', state: 'done' },
      {
        type: 'dynamic-tool',
        toolName: 'shell',
        toolCallId: 'command',
        state: 'input-available',
        input: { command: 'echo hello' },
      },
      { type: 'text', text: 'Last', state: 'streaming' },
    ],
  };
  const hidden: FlueConversationMessage = { ...assistant, id: 'hidden', display: 'diagnostic' };
  const snapshot = {
    conversationId: 'conversation',
    messages: [hidden, assistant],
    settlements: [],
  };
  const live = conversationMessages(snapshot, 'submission');
  expect(live).toEqual([
    {
      id: 'turn:submission',
      role: 'assistant',
      activity: { state: 'running' },
      parts: [
        { type: 'reasoning', id: 'response:1', text: 'Plan', streaming: false },
        { type: 'text', id: 'response:2', text: 'First', streaming: false },
        {
          type: 'tool',
          id: 'command',
          name: 'shell',
          input: { command: 'echo hello' },
          status: 'running',
        },
        { type: 'text', id: 'response:4', text: 'Last', streaming: true },
      ],
    },
  ]);
  expect(conversationMessages(snapshot)).toMatchObject([
    { parts: [{}, {}, { status: 'incomplete' }, { streaming: false }] },
  ]);

  const withEarlierReasoning = {
    ...assistant,
    parts: [
      { type: 'reasoning', text: 'Earlier', state: 'streaming' } as const,
      ...assistant.parts.slice(1),
    ],
  };
  const updated = conversationMessages(
    { ...snapshot, messages: [withEarlierReasoning] },
    'submission',
  );
  expect(updated).toMatchObject([
    {
      parts: [
        { id: 'response:0' },
        { id: 'response:1' },
        { id: 'response:2' },
        { id: 'command' },
        { id: 'response:4' },
      ],
    },
  ]);
});

test('Chat keeps one activity row across pending, streaming and settlement', () => {
  const start = '2026-11-09T00:00:00Z';
  const user: FlueConversationMessage = {
    id: 'input',
    submissionId: 'submission',
    role: 'user',
    purpose: 'user',
    display: 'visible',
    timestamp: start,
    parts: [{ type: 'text', text: 'Start', state: 'done' }],
  };
  const response: FlueConversationMessage = {
    id: 'model-response',
    submissionId: 'submission',
    role: 'assistant',
    purpose: 'assistant',
    display: 'visible',
    timestamp: '2026-11-09T00:00:04Z',
    parts: [{ type: 'text', text: 'Answer', state: 'done' }],
  };
  const initial = { conversationId: 'conversation', messages: [user], settlements: [] };
  const running = { ...initial, messages: [user, response] };
  for (const snapshot of [initial, running]) {
    expect(conversationMessages(snapshot, 'submission')).toMatchObject([
      { id: 'input' },
      { id: 'turn:submission', activity: { state: 'running', startedAt: Date.parse(start) } },
    ]);
  }
  const settled = {
    ...running,
    settlements: [
      {
        submissionId: 'submission',
        outcome: 'completed' as const,
        timestamp: '2026-11-09T00:00:07Z',
      },
    ],
  };
  expect(conversationMessages(settled)).toMatchObject([
    { id: 'input', sentAt: Date.parse(start) },
    {
      id: 'turn:submission',
      completedAt: Date.parse('2026-11-09T00:00:07Z'),
      activity: { state: 'completed', durationMs: 7000 },
    },
  ]);
  expect(conversationMessages(running, 'submission')[1]).toHaveProperty('completedAt', undefined);
  expect(
    conversationMessages({
      ...initial,
      settlements: [{ submissionId: 'submission', outcome: 'aborted' }],
    }),
  ).toMatchObject([
    { id: 'input' },
    { id: 'turn:submission', activity: { state: 'aborted', durationMs: undefined } },
  ]);
});
