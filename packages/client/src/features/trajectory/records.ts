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

export { matchesRecord, payloadText, recordTitle, resultText } from '@workspace/protocol/host';

export function isSummaryRequest(record: TrajectoryRecord) {
  return record.kind === 'assistant' && Boolean(record.compactionId);
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
