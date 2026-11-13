import '@workspace/runtime';
import type { WorkspaceFolders } from '@workspace/protocol/host';
import type { ReadStore } from '../../state/store.js';

export interface Workspace {
  id: string;
  name: string;
  path?: string;
}

export interface WorkspaceClient extends ReadStore<readonly Workspace[]> {
  addWorkspace(this: void, nameOrPath: string): string | Promise<string>;
  browseWorkspaceFolders?(this: void, path?: string): Promise<WorkspaceFolders>;
}

declare module '@workspace/runtime' {
  interface Services {
    workspaces: WorkspaceClient;
  }
}
