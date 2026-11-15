import '@workspace/runtime';
import type { TrajectoryModelInputResponse, TrajectoryPage } from '@workspace/protocol/host';

export interface TrajectorySnapshot {
  requests: Readonly<TrajectoryPage['requests']>;
  before: TrajectoryPage['before'];
  loadingEarlier?: boolean;
  phase: 'loading' | 'live' | 'reconnecting' | 'unavailable';
}

export interface TrajectoryClient {
  getSnapshot(this: void, sessionId: string): TrajectorySnapshot | undefined;
  subscribe(this: void, listener: () => void): () => void;
  observe(this: void, sessionId: string, query: string): () => void;
  loadEarlier(this: void, sessionId: string): void;
  loadModelInput(
    this: void,
    sessionId: string,
    submissionId: string,
    modelRequestId: string,
    signal: AbortSignal,
  ): Promise<TrajectoryModelInputResponse>;
}

declare module '@workspace/runtime' {
  interface Services {
    trajectoryClient: TrajectoryClient;
  }
}
