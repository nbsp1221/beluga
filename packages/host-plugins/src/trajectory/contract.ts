import type { Provider } from '@earendil-works/pi-ai';
import type { Hono } from 'hono';

export const primaryAgentName = 'BelugaPresetAgent';

export interface TrajectoryService {
  bindModelContext(
    contextWindow: (providerId: string, modelId: string) => number | undefined,
  ): void;
  observeProvider(provider: Provider): Provider;
  recordAcceptedInput(sessionId: string, submissionId: string, text: string): void;
  mountRoutes(app: Hono): void;
}

declare module '@workspace/runtime' {
  interface Services {
    trajectory: TrajectoryService;
  }
}
