import type { Plugin } from '@workspace/runtime';
import { createFilesView } from './panel.js';
import '../../workbench/contract.js';

export const filesClient: Plugin = {
  id: 'files',
  requires: ['destinations'],
  setup(context) {
    context.onDispose(
      context.get('destinations').registerPanel({
        id: 'files',
        label: 'Files',
        description: 'Workspace files',
        component: createFilesView(),
      }),
    );
  },
};
