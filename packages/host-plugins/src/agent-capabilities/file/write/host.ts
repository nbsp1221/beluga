import '../../../workspace/file-mutations/services.js';
import type { AgentCapability, AgentCapabilityPlugin } from '../../host.js';
import { createPiEdit } from '../../../pi/edit.js';
import { createPiWrite } from '../../../pi/write.js';
import { AgentToolRegistration } from '../../tool.js';

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
    requires: ['fileAccessPolicy'],
    provides: ['fileWriteTools'],
    setup(context) {
      const policy = context.get('fileAccessPolicy');
      context.provide('fileWriteTools', {
        metadata,
        createTools({ cwd, checkPermission }) {
          const operations = (signal?: AbortSignal) => policy(cwd, checkPermission, signal);

          return [
            AgentToolRegistration.create('write', createPiWrite(cwd, operations)),
            AgentToolRegistration.create('edit', createPiEdit(cwd, operations)),
          ];
        },
      });
    },
  },
};
