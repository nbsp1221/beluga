import type { AgentCapability, AgentCapabilityPlugin } from '../../host.js';
import { createPiGlob } from '../../../pi/glob.js';
import { createPiGrep } from '../../../pi/grep.js';
import { workspaceToolAccess } from '../../../workspace/tool-access.js';
import { bindAgentTool } from '../../tool.js';

const metadata = {
  id: 'file.search',
  name: 'Search files',
  description: 'Find files by name or search file contents.',
  access: 'files',
} satisfies AgentCapability['metadata'];

declare module '@workspace/runtime' {
  interface Services {
    fileSearchTools: AgentCapability;
  }
}

export const fileSearchCapability: AgentCapabilityPlugin = {
  service: 'fileSearchTools',
  plugin: {
    id: 'file-search',
    requires: ['workspaceToolSessions'],
    provides: ['fileSearchTools'],
    setup(context) {
      const sessions = context.get('workspaceToolSessions');
      context.provide('fileSearchTools', {
        metadata,
        createTools(sessionId) {
          const { cwd, authorize } = workspaceToolAccess(sessions, sessionId, metadata);
          return [
            bindAgentTool('glob', createPiGlob(cwd), authorize),
            bindAgentTool('grep', createPiGrep(cwd), authorize),
          ];
        },
      });
    },
  },
};
