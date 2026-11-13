import type { AgentCapability, AgentCapabilityPlugin } from '../../host.js';
import { createPiRead } from '../../../pi/read.js';
import { workspaceToolAccess } from '../../../workspace/tool-access.js';
import { bindAgentTool } from '../../tool.js';

const metadata = {
  id: 'file.read',
  name: 'Read files',
  description: 'Read files from the workspace or another path accessible to the Host.',
  access: 'files',
} satisfies AgentCapability['metadata'];

declare module '@workspace/runtime' {
  interface Services {
    fileReadTools: AgentCapability;
  }
}

export const fileReadCapability: AgentCapabilityPlugin = {
  service: 'fileReadTools',
  plugin: {
    id: 'file-read',
    requires: ['workspaceToolSessions'],
    provides: ['fileReadTools'],
    setup(context) {
      const sessions = context.get('workspaceToolSessions');
      context.provide('fileReadTools', {
        metadata,
        createTools(sessionId) {
          const { cwd, authorize } = workspaceToolAccess(sessions, sessionId, metadata);
          return [bindAgentTool('read', createPiRead(cwd), authorize)];
        },
      });
    },
  },
};
