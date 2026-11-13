import { realpath } from 'node:fs/promises';
import { relative } from 'node:path';
import type { AccessMode, AgentCapabilityMetadata } from '@workspace/protocol/host';
import type { WorkspaceToolSessions } from './services.js';

export function allowsTools(
  access: AgentCapabilityMetadata['access'],
  mode: AccessMode | undefined,
) {
  return (
    mode !== undefined &&
    (access === 'shell' ? mode === 'full-access' : access !== 'file-write' || mode !== 'read-only')
  );
}

export function workspaceToolAccess(
  sessions: WorkspaceToolSessions,
  sessionId: string,
  { id, access }: AgentCapabilityMetadata,
) {
  const cwd = sessions.workspaceRootForSession(sessionId);
  if (!cwd) {
    throw new Error('The workspace is unavailable.');
  }

  function checkPermission() {
    if (
      !sessions.sessionHasCapability(sessionId, id) ||
      !allowsTools(access, sessions.sessionAccessMode(sessionId))
    ) {
      throw new Error('The session does not allow this tool.');
    }
  }

  return {
    cwd,
    checkPermission,
    authorize: async () => {
      const current = await realpath(cwd).catch(() => undefined);
      if (
        !current ||
        relative(cwd, current) ||
        sessions.workspaceRootForSession(sessionId) !== cwd
      ) {
        throw new Error('The workspace is unavailable.');
      }
      checkPermission();
    },
  };
}
