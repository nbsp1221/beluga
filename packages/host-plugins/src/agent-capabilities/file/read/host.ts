import type { AgentCapability, AgentCapabilityPlugin } from '../../host.js';
import { createPiRead } from '../../../pi/read.js';
import { AgentToolRegistration } from '../../tool.js';

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
    requires: [],
    provides: ['fileReadTools'],
    setup(context) {
      context.provide('fileReadTools', {
        metadata,
        createTools({ cwd }) {
          return [AgentToolRegistration.create('read', createPiRead(cwd))];
        },
      });
    },
  },
};
