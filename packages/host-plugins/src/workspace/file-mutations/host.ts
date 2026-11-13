import type { Plugin } from '@workspace/runtime';
import { workspaceMutationOperations } from './operations.js';
import './services.js';

export const workspaceFileAccessPolicy: Plugin = {
  id: 'workspace-file-access',
  provides: ['fileAccessPolicy'],
  setup(context) {
    context.provide('fileAccessPolicy', workspaceMutationOperations);
  },
};
