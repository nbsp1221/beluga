import {
  WORKSPACES_PATH,
  WORKSPACE_FOLDERS_PATH,
  workspaceFoldersSchema,
  workspaceSchema,
} from '@workspace/protocol/host';
import type { HostRequest } from '../../../transport/host-http.js';
import type { Workspace, WorkspaceClient } from '../contract.js';
import { createStore } from '../../../state/store.js';

export function createConnectedWorkspaces(
  request: HostRequest,
  initial: readonly Workspace[],
): WorkspaceClient {
  const store = createStore(initial);
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    async addWorkspace(path) {
      const workspace = workspaceSchema.parse(await request(WORKSPACES_PATH, { path }));
      if (!store.getSnapshot().some(({ id }) => id === workspace.id)) {
        store.publish([...store.getSnapshot(), workspace]);
      }
      return workspace.id;
    },
    async browseWorkspaceFolders(path) {
      return workspaceFoldersSchema.parse(
        await request(
          path === undefined
            ? WORKSPACE_FOLDERS_PATH
            : `${WORKSPACE_FOLDERS_PATH}?${new URLSearchParams({ path })}`,
        ),
      );
    },
  };
}
