import type { AgentCapability, AgentCapabilityPlugin } from '../../host.js';
import { createPiGlob } from '../../../pi/glob.js';
import { createPiGrep } from '../../../pi/grep.js';
import { AgentToolRegistration } from '../../tool.js';

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
    requires: [],
    provides: ['fileSearchTools'],
    setup(context) {
      context.provide('fileSearchTools', {
        metadata,
        createTools({ cwd }) {
          return [
            AgentToolRegistration.create('glob', createPiGlob(cwd)),
            AgentToolRegistration.create('grep', createPiGrep(cwd)),
          ];
        },
      });
    },
  },
};
