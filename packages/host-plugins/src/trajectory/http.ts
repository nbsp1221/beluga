import type { Hono } from 'hono';
import { CONVERSATION_PATH } from '@workspace/protocol/host';
import type { TrajectoryStore } from './store.js';

export function mountTrajectoryRoutes(
  app: Hono,
  sessionExists: (id: string) => boolean,
  store: Pick<TrajectoryStore, 'history' | 'modelInput' | 'usage'>,
  selection: (id: string) => { model: string; revision: number } | undefined,
) {
  app.get(`${CONVERSATION_PATH}/:id/trajectory/:submissionId/:modelId`, (c) => {
    const { id, submissionId, modelId } = c.req.param();
    if (!sessionExists(id)) {
      return c.json({ error: 'Unknown session' }, 404);
    }
    const input = store.modelInput(id, submissionId, modelId);
    return input ? c.json(input) : c.json({ error: 'Model input unavailable' }, 404);
  });

  app.get(`${CONVERSATION_PATH}/:id/trajectory`, (c) => {
    const id = c.req.param('id');
    if (!sessionExists(id)) {
      return c.json({ error: 'Unknown session' }, 404);
    }
    return c.json(store.history(id));
  });

  app.get(`${CONVERSATION_PATH}/:id/usage`, (c) => {
    const id = c.req.param('id');
    if (!sessionExists(id)) {
      return c.json({ error: 'Unknown session' }, 404);
    }
    return c.json(store.usage(id, selection(id)));
  });
}
