import {
  WORKSPACES_PATH,
  WORKSPACE_FOLDERS_PATH,
  workspaceFoldersSchema,
  workspaceSchema,
} from '@workspace/protocol/host';
import type { HostRequest } from '../../../transport/host-http.js';
import type { ConnectedWorkspaceClient, Workspace } from '../contract.js';
import { createStore } from '../../../state/store.js';

export function createConnectedWorkspaces(
  request: HostRequest,
  initial: readonly Workspace[],
): ConnectedWorkspaceClient {
  const store = createStore(initial);

  function merge(workspaces: readonly Workspace[]) {
    const current = store.getSnapshot();
    const known = new Set(current.map(({ id }) => id));
    const added = workspaces.filter(({ id }) => !known.has(id));
    if (added.length) {
      store.publish([...current, ...added]);
    }
  }

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    merge,
    async addWorkspace(path) {
      const workspace = workspaceSchema.parse(await request(WORKSPACES_PATH, { path }));
      merge([workspace]);
      return workspace.id;
    },
    async browseWorkspaceFolders(path, signal) {
      return workspaceFoldersSchema.parse(
        await request(
          path === undefined
            ? WORKSPACE_FOLDERS_PATH
            : `${WORKSPACE_FOLDERS_PATH}?${new URLSearchParams({ path })}`,
          undefined,
          'GET',
          signal,
        ),
      );
    },
  };
}
