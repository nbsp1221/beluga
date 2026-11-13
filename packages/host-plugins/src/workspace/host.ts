import type { Plugin } from '@workspace/runtime';
import { WORKSPACES_PATH, WORKSPACE_FOLDERS_PATH } from '@workspace/protocol/host';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import '../auth/services.js';
import { openWorkspaceCatalog } from './catalog.js';
import { FolderError, browseFolders, resolveFolder } from './folders.js';
import './services.js';

export { workspaceCatalogPath } from './catalog.js';

export function createWorkspaceHost(catalogPath: string): Plugin {
  return {
    id: 'workspace',
    requires: ['auth'],
    provides: ['workspaceCatalog', 'workspaceToolSessions', 'sessionExists', 'workspaceHttp'],
    setup(context) {
      const auth = context.get('auth');
      const { catalog, close } = openWorkspaceCatalog(catalogPath);
      context.onDispose(close);
      const { add, workspaceRootForSession, ...conversationCatalog } = catalog;

      const app = new Hono();
      app.use('*', async (c, next) => {
        c.header('Cache-Control', 'no-store');
        if (!(await auth.authenticate(c.req.raw))) {
          return c.json({ error: 'Unauthorized' }, 401);
        }
        await next();
      });

      app.onError((error, c) => {
        if (error instanceof FolderError) {
          return c.json({ error: error.message }, error.status);
        }
        throw error;
      });

      app.get(WORKSPACE_FOLDERS_PATH, async (c) =>
        c.json(await browseFolders(c.req.query('path'))),
      );
      app.post(WORKSPACES_PATH, bodyLimit({ maxSize: 32 * 1024 }), async (c) => {
        const body = await c.req.json<unknown>().catch(() => null);
        const path = body && typeof body === 'object' && 'path' in body ? body.path : undefined;
        if (typeof path !== 'string' || !path) {
          return c.json({ error: 'Choose a folder on the Host.' }, 400);
        }
        const { workspace, created } = add(await resolveFolder(path));
        return c.json(workspace, created ? 201 : 200);
      });
      context.provide('workspaceCatalog', conversationCatalog);
      context.provide('workspaceToolSessions', {
        workspaceRootForSession,
        sessionHasCapability: (id, capabilityId) =>
          catalog.sessionPreset(id)?.capabilities.includes(capabilityId) ?? false,
        sessionAccessMode: catalog.sessionAccessMode,
      });
      context.provide('sessionExists', (id) => catalog.findSession(id) !== undefined);
      context.provide('workspaceHttp', { fetch: app.fetch });
    },
  };
}
