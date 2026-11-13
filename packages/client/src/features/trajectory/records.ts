import type {
  TrajectoryRecord,
  TrajectoryRequest,
  TrajectoryStatus,
} from '@workspace/protocol/host';

export const statusLabels: Record<TrajectoryStatus, string> = {
  'in-progress': 'In progress',
  'completed': 'Completed',
  'failed': 'Failed',
  'interrupted': 'Interrupted',
  'unavailable': 'Unavailable',
};

export function payloadText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function resultText(output: unknown) {
  if (
    output &&
    typeof output === 'object' &&
    'content' in output &&
    Array.isArray(output.content)
  ) {
    const text = output.content
      .flatMap((part: unknown) =>
        part &&
        typeof part === 'object' &&
        'type' in part &&
        part.type === 'text' &&
        'text' in part &&
        typeof part.text === 'string'
          ? [part.text]
          : [],
      )
      .join('\n');
    if (text) {
      return text;
    }
  }
  return payloadText(output);
}

export function recordTitle(record: TrajectoryRecord) {
  if (record.kind === 'compaction') {
    return record.text;
  }
  if (record.kind !== 'tool') {
    return record.kind;
  }
  return record.name;
}

export function isSummaryRequest(record: TrajectoryRecord) {
  return record.kind === 'assistant' && Boolean(record.compactionId);
}

export function matchesRecord(record: TrajectoryRecord, query: string) {
  return (
    record.kind === 'tool'
      ? [
          recordTitle(record),
          payloadText(record.input),
          record.error,
          resultText(record.output),
          payloadText(record.schema),
        ]
      : [recordTitle(record), record.text]
  ).some((value) => value?.toLowerCase().includes(query));
}

export function durationText(ms?: number) {
  if (ms === undefined) {
    return '—';
  }
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function recordKey(request: TrajectoryRequest, record: TrajectoryRecord) {
  return `${request.id}/${record.id}`;
}
