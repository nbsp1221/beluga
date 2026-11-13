import type { Plugin } from '@workspace/runtime';
import { Suspense, lazy, useEffect, useSyncExternalStore } from 'react';
import type { Session } from '../conversation/contract.js';
import { subscribeToEmptyStore } from '../../state/store.js';
import type { TrajectoryClient } from './contract.js';
import { TrajectoryViewLoading } from './loading.js';

const TrajectoryView = lazy(async () => ({
  default: (await import('./view.js')).TrajectoryView,
}));

function TrajectoryPane({
  session,
  active,
  client,
}: {
  session: Session;
  active?: boolean;
  client?: TrajectoryClient;
}) {
  const snapshot = useSyncExternalStore(client?.subscribe ?? subscribeToEmptyStore, () =>
    client?.getSnapshot(session.id),
  );
  useEffect(() => {
    if (active && !session.isDraft) {
      return client?.observe(session.id);
    }
  }, [client, active, session.id, session.isDraft]);

  return (
    <Suspense fallback={<TrajectoryViewLoading />}>
      <TrajectoryView
        key={session.id}
        sessionId={session.id}
        snapshot={snapshot}
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
