import {
  CONVERSATION_PATH,
  trajectoryHistorySchema,
  trajectoryModelInputResponseSchema,
} from '@workspace/protocol/host';
import type { TrajectoryClient, TrajectorySnapshot } from '../contract.js';
import { createStore } from '../../../state/store.js';

export function createConnectedTrajectory(
  signal: AbortSignal,
  fetchHost: typeof fetch,
): TrajectoryClient {
  const store = createStore(new Map<string, TrajectorySnapshot>());
  return {
    getSnapshot: (id) => store.getSnapshot().get(id),
    subscribe: store.subscribe,
    async loadModelInput(id, submissionId, modelId, requestSignal) {
      const path = [id, 'trajectory', submissionId, modelId].map(encodeURIComponent).join('/');
      const response = await fetchHost(`${CONVERSATION_PATH}/${path}`, {
        signal: AbortSignal.any([signal, requestSignal]),
      });
      if (!response.ok) {
        throw new Error('Model input unavailable');
      }
      return trajectoryModelInputResponseSchema.parse(await response.json());
    },
    observe(id) {
      const controller = new AbortController();
      const stopSignal = AbortSignal.any([signal, controller.signal]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let lastBody: string | undefined;
      let hasLoaded = false;

      function update(
        phase: TrajectorySnapshot['phase'],
        requests = store.getSnapshot().get(id)?.requests ?? [],
      ) {
        const next = new Map(store.getSnapshot());
        next.set(id, { phase, requests });
        store.publish(next);
      }

      update('loading');

      async function refresh() {
        let hasActiveRequests = false;
        try {
          const response = await fetchHost(
            `${CONVERSATION_PATH}/${encodeURIComponent(id)}/trajectory`,
            { signal: stopSignal },
          );
          if (!response.ok) {
            throw new Error('Trajectory history unavailable');
          }
          const body = await response.text();
          if (stopSignal.aborted) {
            return;
          }
          if (body !== lastBody) {
            const requests = trajectoryHistorySchema.parse(JSON.parse(body));
            lastBody = body;
            hasLoaded = true;
            hasActiveRequests = requests.some((request) => request.status === 'in-progress');
            update('live', requests);
          } else {
            hasActiveRequests =
              store
                .getSnapshot()
                .get(id)
                ?.requests.some((request) => request.status === 'in-progress') ?? false;
          }
        } catch {
          if (stopSignal.aborted) {
            return;
          }
          lastBody = undefined;
          update(hasLoaded ? 'reconnecting' : 'unavailable');
        }
        scheduleRefresh(hasActiveRequests);
      }

      function scheduleRefresh(hasActiveRequests: boolean) {
        // Publishing an update can synchronously notify a subscriber that stops polling.
        if (!stopSignal.aborted) {
          timer = setTimeout(() => void refresh(), hasActiveRequests ? 750 : 1500);
        }
      }

      void refresh();
      return () => {
        controller.abort();
        clearTimeout(timer);
      };
    },
  };
}
