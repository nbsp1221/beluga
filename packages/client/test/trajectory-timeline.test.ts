import type { TrajectoryRequest } from '@workspace/protocol/host';
import { expect, test } from 'vitest';
import { timelineSpans } from '../src/features/trajectory/timeline-spans.js';

const requests: TrajectoryRequest[] = [
  {
    id: 'first',
    status: 'completed',
    records: [
      {
        id: 'system',
        kind: 'system',
        text: 'System prompt',
        initial: true,
        modelRequestId: 'model',
        timestamp: '2026-11-10T00:00:00Z',
      },
      { id: 'user', kind: 'user', text: 'Check the project' },
      {
        id: 'model',
        kind: 'assistant',
        text: '',
        status: 'completed',
        timestamp: '2026-11-10T00:00:01Z',
        firstOutputAt: '2026-11-10T00:00:02Z',
        durationMs: 4000,
      },
      {
        id: 'tool',
        kind: 'tool',
        name: 'read',
        status: 'completed',
        modelRequestId: 'model',
        timestamp: '2026-11-10T00:00:03Z',
        durationMs: 4000,
      },
    ],
  },
  {
    id: 'second',
    status: 'completed',
    records: [
      {
        id: 'model',
        kind: 'assistant',
        text: 'Done',
        status: 'completed',
        timestamp: '2026-11-10T00:00:20Z',
        endedAt: '2026-11-10T00:00:22Z',
      },
    ],
  },
];

test('duration mode shares overlapping time, compresses idle gaps, and keeps untimed markers', () => {
  const [system, user, model, tool, later] = timelineSpans(requests, true);

  expect(system).toMatchObject({ start: 0, end: 0, markOnly: true });
  expect(user).toMatchObject({ start: 0.2, end: 0.4, markOnly: true });
  expect(model).toMatchObject({ start: 0, end: 0.5, firstOutputFraction: 0.25 });
  expect(tool).toMatchObject({ start: 0.25, end: 0.75 });
  expect(later).toMatchObject({ start: 0.75, end: 1 });
});

test('record order preserves turn boundaries and numbers requests after earlier pages', () => {
  const spans = timelineSpans(requests, false, 11);

  expect(spans.map(({ start, end }) => [start, end])).toEqual([
    [0, 0.2],
    [0.2, 0.4],
    [0.4, 0.6],
    [0.6, 0.8],
    [0.8, 1],
  ]);
  expect(spans.filter(({ boundary }) => boundary).map(({ key }) => key)).toEqual([
    'first/user',
    'second/model',
  ]);
  expect(spans.flatMap(({ requestNumber }) => requestNumber ?? [])).toEqual([12, 13]);
});
