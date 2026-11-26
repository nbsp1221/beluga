import type { Hono } from 'hono';

export const primaryAgentName = 'BelugaPresetAgent';

export interface TrajectoryService {
  bindModelContext(
    contextWindow: (providerId: string, modelId: string) => number | undefined,
  ): void;
  recordAcceptedInput(sessionId: string, submissionId: string, text: string): void;
  mountRoutes(app: Hono): void;
}

declare module '@workspace/runtime' {
  interface Services {
    trajectory: TrajectoryService;
  }
}
