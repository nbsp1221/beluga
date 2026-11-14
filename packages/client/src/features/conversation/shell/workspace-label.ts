import type { Workspace } from '../../workspaces/contract.js';

export function workspaceLabel(workspace: Workspace, workspaces: readonly Workspace[]) {
  return workspace.path &&
    workspaces.some((item) => item.id !== workspace.id && item.name === workspace.name)
    ? workspace.path
    : workspace.name;
}
