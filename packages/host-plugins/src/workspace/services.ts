import type { AccessMode } from '@workspace/protocol/host';
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

declare module '@workspace/runtime' {
  interface Services {
    workspaceCatalog: WorkspaceCatalog;
    workspaceToolSessions: WorkspaceToolSessions;
    sessionExists(id: string): boolean;
    workspaceHttp: HttpService;
  }
}
