import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import { productRoutes, trajectorySearchSchema } from '@workspace/protocol/host';
import type { TrajectoryStore } from './store.js';

export function mountTrajectoryRoutes(
  app: Hono,
  sessionExists: (id: string) => boolean,
  store: Pick<TrajectoryStore, 'page' | 'revision' | 'modelInput' | 'usage'>,
  selection: (id: string) => { model: string; revision: number } | undefined,
) {
  app.on(productRoutes.modelInput.method, productRoutes.modelInput.path, (c) => {
    const { id, submissionId, modelId } = c.req.param();
    if (!sessionExists(id)) {
      return c.json({ error: 'Unknown session' }, 404);
    }
    const input = store.modelInput(id, submissionId, modelId);
    return input ? c.json(input) : c.json({ error: 'Model input unavailable' }, 404);
  });

  app.on(productRoutes.trajectory.method, productRoutes.trajectory.path, (c) => {
    const id = c.req.param('id');
    if (!sessionExists(id)) {
      return c.json({ error: 'Unknown session' }, 404);
    }
    const before = c.req.query('before');
    const cursor = before === undefined ? undefined : Number(before);
    const search = trajectorySearchSchema.safeParse(c.req.query('q') ?? '');
    if (
      (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1)) ||
      !search.success
    ) {
      return c.json({ error: 'Invalid Trajectory query.' }, 400);
    }
    const query = search.data;
    const etag = responseTag([id, store.revision(id), cursor, query]);
    c.header('ETag', etag);
    if (c.req.header('If-None-Match') === etag) {
      return c.body(null, 304);
    }
    return c.json(store.page(id, cursor, query, 50));
  });

  app.on(productRoutes.usage.method, productRoutes.usage.path, (c) => {
    const id = c.req.param('id');
    if (!sessionExists(id)) {
      return c.json({ error: 'Unknown session' }, 404);
    }
    const model = selection(id);
    const etag = responseTag([id, store.revision(id), model]);
    c.header('ETag', etag);
    if (c.req.header('If-None-Match') === etag) {
      return c.body(null, 304);
    }
    return c.json(store.usage(id, model));
  });
}

function responseTag(parts: unknown[]) {
  return `"${createHash('sha256').update(JSON.stringify(parts)).digest('base64url')}"`;
}
