import {
  CONVERSATION_PATH,
  trajectoryModelInputResponseSchema,
  trajectoryPageSchema,
  trajectorySearchSchema,
} from '@workspace/protocol/host';
import type { TrajectoryClient, TrajectorySnapshot } from '../contract.js';
import { createStore } from '../../../state/store.js';

export function createConnectedTrajectory(
  signal: AbortSignal,
  fetchHost: typeof fetch,
): TrajectoryClient {
  const store = createStore(new Map<string, TrajectorySnapshot>());
  const earlier = new Map<string, () => Promise<void>>();
  const observedQueries = new Map<string, string>();
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
    loadEarlier(id) {
      void earlier.get(id)?.();
    },
    observe(id, input) {
      const search = trajectorySearchSchema.safeParse(input);
      if (!search.success) {
        return () => {};
      }
      const query = search.data;
      const controller = new AbortController();
      const stopSignal = AbortSignal.any([signal, controller.signal]);

      const stopped = () => stopSignal.aborted;

      let timer: ReturnType<typeof setTimeout> | undefined;
      let etag: string | null = null;
      let hasLoaded = observedQueries.get(id) === query;
      let loadingEarlier = false;
      const path = `${CONVERSATION_PATH}/${encodeURIComponent(id)}/trajectory`;

      function update(snapshot: TrajectorySnapshot) {
        const next = new Map(store.getSnapshot());
        next.set(id, snapshot);
        store.publish(next);
      }

      const snapshot = () =>
        store.getSnapshot().get(id) ?? { phase: 'loading', before: null, requests: [] };

      const endpoint = (before?: number) => {
        const params = new URLSearchParams({ q: query });
        if (before !== undefined) {
          params.set('before', String(before));
        }
        return path + '?' + params.toString();
      };

      if (!hasLoaded) {
        observedQueries.delete(id);
        update({ phase: 'loading', before: null, requests: [] });
      }

      async function loadEarlier() {
        const { before, requests } = snapshot();
        if (!before || loadingEarlier || stopped()) {
          return;
        }
        const firstId = requests[0]?.request.id;

        const samePage = (current: TrajectorySnapshot) =>
          current.before === before && current.requests[0]?.request.id === firstId;

        loadingEarlier = true;
        update({ ...snapshot(), loadingEarlier: true });
        try {
          const response = await fetchHost(endpoint(before), { signal: stopSignal });
          if (!response.ok) {
            throw new Error('Earlier Trajectory records unavailable');
          }
          const page = trajectoryPageSchema.parse(await response.json());
          const current = snapshot();
          if (!stopped() && samePage(current)) {
            update({
              ...current,
              before: page.before,
              requests: [...page.requests, ...current.requests],
            });
          }
        } catch {
          const current = snapshot();
          if (!stopped() && samePage(current)) {
            update({ ...current, phase: 'reconnecting' });
          }
        } finally {
          loadingEarlier = false;
          if (!stopped()) {
            update({ ...snapshot(), loadingEarlier: false });
          }
        }
      }

      earlier.set(id, loadEarlier);

      async function refresh() {
        try {
          const response = await fetchHost(endpoint(), {
            signal: stopSignal,
            ...(etag ? { headers: { 'If-None-Match': etag } } : {}),
          });
          if (response.status === 304) {
            if (!stopSignal.aborted && snapshot().phase !== 'live') {
              update({ ...snapshot(), phase: 'live' });
            }
            return;
          }
          if (!response.ok) {
            throw new Error('Trajectory history unavailable');
          }
          const page = trajectoryPageSchema.parse(await response.json());
          if (stopSignal.aborted) {
            return;
          }
          etag = response.headers.get('ETag');
          hasLoaded = true;
          observedQueries.set(id, query);
          const current = snapshot();
          const first = page.requests.at(0)?.turn;
          const overlaps = page.requests.some(({ request }) =>
            current.requests.some((cached) => cached.request.id === request.id),
          );
          const older =
            first === undefined || page.before === null || !overlaps
              ? []
              : current.requests.filter(({ turn }) => turn < first);
          update({
            phase: 'live',
            before: older.length ? current.before : page.before,
            requests: [...older, ...page.requests],
            loadingEarlier,
          });
        } catch {
          if (stopSignal.aborted) {
            return;
          }
          update({ ...snapshot(), phase: hasLoaded ? 'reconnecting' : 'unavailable' });
        } finally {
          scheduleRefresh(
            snapshot().requests.some(({ request }) => request.status === 'in-progress'),
          );
        }
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
        if (earlier.get(id) === loadEarlier) {
          earlier.delete(id);
        }
        clearTimeout(timer);
      };
    },
  };
}
