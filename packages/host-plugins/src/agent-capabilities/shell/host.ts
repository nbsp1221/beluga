import type { AgentCapability, AgentCapabilityPlugin } from '../host.js';
import { createPiShell, shellName } from '../../pi/shell.js';
import { workspaceToolAccess } from '../../workspace/tool-access.js';
import { bindAgentTool } from '../tool.js';

const metadata = {
  id: 'shell.exec',
  name: 'Run shell commands',
  description: 'Run a command as the Host account in a Full access conversation.',
  access: 'shell',
} satisfies AgentCapability['metadata'];

declare module '@workspace/runtime' {
  interface Services {
    shellExecTools: AgentCapability;
  }
}

export const shellExecCapability: AgentCapabilityPlugin = {
  service: 'shellExecTools',
  plugin: {
    id: 'shell-exec',
    requires: ['workspaceToolSessions'],
    provides: ['shellExecTools'],
    setup(context) {
      const sessions = context.get('workspaceToolSessions');
      context.provide('shellExecTools', {
        metadata,
        createTools(sessionId) {
          const { cwd, authorize, checkPermission } = workspaceToolAccess(
            sessions,
            sessionId,
            metadata,
          );
          return [bindAgentTool(shellName, createPiShell(cwd, checkPermission), authorize)];
        },
      });
    },
  },
};
