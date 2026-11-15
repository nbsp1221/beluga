import { DatabaseSync } from 'node:sqlite';
import type { Plugin } from '@workspace/runtime';
import { observeFlueTrajectory } from './flue-recorder.js';
import { mountTrajectoryRoutes } from './http.js';
import { createTrajectoryStore } from './store.js';
import './contract.js';
import '../workspace/services.js';

export function createTrajectoryHost(databasePath: string): Plugin {
  return {
    id: 'trajectory',
    requires: ['sessionExists', 'workspaceCatalog'],
    provides: ['trajectory'],
    setup(context) {
      const sessionExists = context.get('sessionExists');
      const catalog = context.get('workspaceCatalog');
      const db = new DatabaseSync(databasePath);
      context.onDispose(() => db.close());
      const store = createTrajectoryStore(db);

      let contextWindow: (providerId: string, modelId: string) => number | undefined = () =>
        undefined;

      // Flue reconciles unfinished submissions during startup.
      context.onDispose(
        observeFlueTrajectory(store, {
          ownsSession: sessionExists,
          selection: (id) => catalog.contextModel(id),
          contextWindow: (provider, model) => contextWindow(provider, model),
          reportFailure: (error) => reportFailure('activity', error),
        }),
      );

      context.provide('trajectory', {
        bindModelContext(lookup) {
          contextWindow = lookup;
        },
        mountRoutes(app) {
          mountTrajectoryRoutes(app, sessionExists, store, (id) => catalog.contextModel(id));
        },
        recordAcceptedInput(sessionId, submissionId, text) {
          const recordId = `input:${submissionId}`;
          try {
            // A retry with the same receipt keeps the original record.
            if (!store.get(sessionId, submissionId, recordId)) {
              store.put(sessionId, submissionId, {
                id: recordId,
                kind: 'user',
                text,
                timestamp: new Date().toISOString(),
              });
            }
          } catch (error) {
            reportFailure('input', error);
          }
        },
      });
    },
  };
}

function reportFailure(kind: 'activity' | 'input', error: unknown) {
  console.error(
    `Could not record Trajectory ${kind}`,
    error instanceof Error ? error.name : 'Unknown error',
  );
}
