import { v4 as uuid } from 'uuid';
import type { Workspace, WorkspaceClient } from '../contract.js';
import { createStore } from '../../../state/store.js';

export function createDemoWorkspaces(): WorkspaceClient {
  const store = createStore<readonly Workspace[]>([{ id: 'example', name: 'Example project' }]);

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    addWorkspace(name) {
      const label = name.trim();
      if (!label) {
        throw new Error('Enter a workspace name.');
      }
      const workspaces = store.getSnapshot();
      if (workspaces.some((item) => item.name.toLowerCase() === label.toLowerCase())) {
        throw new Error('A workspace with this name exists. Choose another name.');
      }
      const id = uuid();
      store.publish([...workspaces, { id, name: label }]);
      return id;
    },
  };
}
