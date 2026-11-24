import type { realpath, stat } from 'node:fs/promises';
import type { AccessMode } from '@workspace/protocol/host';
import type { read } from '../filesystem/read.js';
import type { HttpService } from '../http/contract.js';
import type { createWorkspaceCatalog } from './catalog.js';

export type WorkspaceCatalog = Omit<
  ReturnType<typeof createWorkspaceCatalog>,
  'add' | 'workspaceRootForSession'
>;

export interface WorkspaceToolSessions {
  workspaceRootForSession(id: string): string | undefined;
  sessionHasCapability(id: string, capabilityId: string): boolean;
  sessionAccessMode(id: string): AccessMode | undefined;
}

export interface WorkspaceFiles {
  realpath: typeof realpath;
  stat: typeof stat;
  read: typeof read;
}

declare module '@workspace/runtime' {
  interface Services {
    workspaceCatalog: WorkspaceCatalog;
    workspaceToolSessions: WorkspaceToolSessions;
    workspaceFiles: WorkspaceFiles;
    sessionExists(id: string): boolean;
    workspaceHttp: HttpService;
  }
}
