import type { AgentCapability, AgentCapabilityPlugin } from '../host.js';
import { createPiShell, shellName } from '../../pi/shell.js';
import { AgentToolRegistration } from '../tool.js';

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
    requires: [],
    provides: ['shellExecTools'],
    setup(context) {
      context.provide('shellExecTools', {
        metadata,
        createTools({ cwd, checkPermission }) {
          return [AgentToolRegistration.create(shellName, createPiShell(cwd, checkPermission))];
        },
      });
    },
  },
};
