import type { TrajectoryRequest } from '@workspace/protocol/host';
import { isSummaryRequest, recordKey } from './records.js';

export type TimeRange = readonly [number, number];

export function timelineSpans(
  requests: readonly TrajectoryRequest[],
  duration: boolean,
  requestNumberOffset = 0,
) {
  let requestNumber = requestNumberOffset;
  const items = requests.flatMap((request, turnIndex) => {
    let step = 0;
    return request.records
      .filter((record) => !isSummaryRequest(record))
      .map((record, index) => ({
        key: recordKey(request, record),
        request,
        turnIndex,
        record,
        boundary:
          index === (request.records[0]?.kind === 'system' && request.records[0].initial ? 1 : 0),
        duration:
          record.kind === 'assistant' || record.kind === 'tool' || record.kind === 'compaction'
            ? record.durationMs
            : undefined,
        step: record.kind === 'assistant' ? ++step : step,
        requestNumber: record.kind === 'assistant' ? ++requestNumber : undefined,
      }));
  });

  const parseTimestamp = (value?: string) => (value ? Date.parse(value) : NaN);

  const intervals = items.map(({ record, duration }) => {
    const start = parseTimestamp(record.timestamp);
    const end =
      duration !== undefined
        ? start + duration
        : record.kind === 'assistant' || record.kind === 'tool' || record.kind === 'compaction'
          ? parseTimestamp(record.endedAt)
          : start;
    return { start, end: Number.isFinite(end) && end > start ? end : start };
  });

  const durationPositions = duration ? compressIdleGaps(intervals) : undefined;

  return items.map((item, index) => {
    const timedPosition = durationPositions?.get(index);
    const [start, end] = timedPosition ?? [index / items.length, (index + 1) / items.length];
    const model = item.record.kind === 'assistant' ? item.record : undefined;
    const firstOutput = parseTimestamp(model?.firstOutputAt);
    const interval = intervals[index];
    const firstOutputFraction =
      firstOutput > interval.start && firstOutput < interval.end
        ? (firstOutput - interval.start) / (interval.end - interval.start)
        : undefined;
    return {
      ...item,
      start,
      end,
      firstOutputFraction,
      markOnly: duration && (start === end || timedPosition === undefined),
    };
  });
}

function compressIdleGaps(intervals: readonly { start: number; end: number }[]) {
  const ordered = intervals
    .map((interval, index) => ({ ...interval, index }))
    .filter(({ start }) => Number.isFinite(start))
    .sort((a, b) => a.start - b.start);

  // Overlapping intervals share the same section of the compressed axis.
  const activeSections: { start: number; end: number; offset: number }[] = [];
  let activeDuration = 0;
  for (const { start, end } of ordered) {
    const previous = activeSections.at(-1);
    if (previous && start <= previous.end) {
      activeDuration += Math.max(0, end - previous.end);
      previous.end = Math.max(previous.end, end);
    } else {
      activeSections.push({ start, end, offset: activeDuration });
      activeDuration += end - start;
    }
  }

  const positions = new Map<number, TimeRange>();
  if (!(activeDuration > 0)) {
    return positions;
  }

  let sectionIndex = 0;
  for (const { start, end, index } of ordered) {
    while (activeSections[sectionIndex].end < start) {
      sectionIndex++;
    }
    const section = activeSections[sectionIndex];
    positions.set(index, [
      (section.offset + start - section.start) / activeDuration,
      (section.offset + end - section.start) / activeDuration,
    ]);
  }
  return positions;
}

export type TimelineSpan = ReturnType<typeof timelineSpans>[number];
