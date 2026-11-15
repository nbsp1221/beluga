import type { Plugin } from '@workspace/runtime';
import { trajectorySearchSchema } from '@workspace/protocol/host';
import { Suspense, lazy, useDeferredValue, useEffect, useState, useSyncExternalStore } from 'react';
import type { Session } from '../conversation/contract.js';
import { subscribeToEmptyStore } from '../../state/store.js';
import type { TrajectoryClient } from './contract.js';
import { TrajectoryViewFrame } from './loading.js';

const TrajectoryView = lazy(() =>
  import('./view.js').then(
    ({ TrajectoryView }) => ({ default: TrajectoryView }),
    (error: unknown) => {
      console.error('Could not load Trajectory.', error);
      return { default: TrajectoryUnavailable };
    },
  ),
);

function TrajectoryUnavailable() {
  return <TrajectoryViewFrame unavailable />;
}

function TrajectoryPane({
  session,
  active,
  client,
}: {
  session: Session;
  active?: boolean;
  client?: TrajectoryClient;
}) {
  const [search, setSearch] = useState({ sessionId: session.id, query: '' });
  const query = search.sessionId === session.id ? search.query : '';
  const normalized = trajectorySearchSchema.safeParse(query);
  const valid = normalized.success;
  const term = useDeferredValue(normalized.data ?? '');
  const snapshot = useSyncExternalStore(client?.subscribe ?? subscribeToEmptyStore, () =>
    client?.getSnapshot(session.id),
  );
  useEffect(() => {
    if (active && !session.isDraft && valid) {
      return client?.observe(session.id, term);
    }
  }, [client, active, session.id, session.isDraft, term, valid]);

  return (
    <Suspense fallback={<TrajectoryViewFrame />}>
      <TrajectoryView
        key={session.id}
        sessionId={session.id}
        snapshot={snapshot}
        query={query}
        term={term}
        invalidSearch={!valid}
        onSearch={(query) => setSearch({ sessionId: session.id, query })}
        onLoadEarlier={() => client?.loadEarlier(session.id)}
        loadModelInput={client?.loadModelInput}
      />
    </Suspense>
  );
}

export function createTrajectoryPlugin(connected: boolean): Plugin {
  return {
    id: 'trajectory',
    requires: ['conversationViews', ...(connected ? (['trajectoryClient'] as const) : [])],
    setup(context) {
      const client = connected ? context.get('trajectoryClient') : undefined;
      context.onDispose(
        context.get('conversationViews').register({
          id: 'trajectory',
          label: 'Trajectory',
          component: (props) => <TrajectoryPane {...props} client={client} />,
          composer: 'floating',
        }),
      );
    },
  };
}
