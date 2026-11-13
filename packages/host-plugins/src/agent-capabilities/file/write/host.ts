import '../../../workspace/file-mutations/services.js';
import type { AgentCapability, AgentCapabilityPlugin } from '../../host.js';
import { createPiEdit } from '../../../pi/edit.js';
import { createPiWrite } from '../../../pi/write.js';
import { workspaceToolAccess } from '../../../workspace/tool-access.js';
import { bindAgentTool } from '../../tool.js';

const metadata = {
  id: 'file.write',
  name: 'Write and edit files',
  description: 'Write or edit files within the workspace.',
  access: 'file-write',
} satisfies AgentCapability['metadata'];

declare module '@workspace/runtime' {
  interface Services {
    fileWriteTools: AgentCapability;
  }
}

export const fileWriteCapability: AgentCapabilityPlugin = {
  service: 'fileWriteTools',
  plugin: {
    id: 'file-write',
    requires: ['workspaceToolSessions', 'fileAccessPolicy'],
    provides: ['fileWriteTools'],
    setup(context) {
      const sessions = context.get('workspaceToolSessions');
      const policy = context.get('fileAccessPolicy');
      context.provide('fileWriteTools', {
        metadata,
        createTools(sessionId) {
          const { cwd, authorize, checkPermission } = workspaceToolAccess(
            sessions,
            sessionId,
            metadata,
          );

          const operations = (signal?: AbortSignal) => policy(cwd, checkPermission, signal);

          return [
            bindAgentTool('write', createPiWrite(cwd, operations), authorize),
            bindAgentTool('edit', createPiEdit(cwd, operations), authorize),
          ];
        },
      });
    },
  },
};
