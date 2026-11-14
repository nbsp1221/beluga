import type { Plugin } from '@workspace/runtime';
import { createFilesView } from './panel.js';
import '../../workbench/contract.js';

export function createFilesPlugin(connected: boolean): Plugin {
  return {
    id: 'files',
    requires: ['destinations'],
    setup(context) {
      context.onDispose(
        context.get('destinations').registerPanel({
          id: 'files',
          label: 'Files',
          description: 'Workspace files',
          component: createFilesView(),
          unavailable: connected,
        }),
      );
    },
  };
}
