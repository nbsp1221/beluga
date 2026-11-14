import type { Edit, EditOperations } from '../filesystem/edit.js';
import { adaptPiTool, loadPi } from './tool.js';

function createTool(cwd: string, operations?: (signal?: AbortSignal) => EditOperations) {
  const { createEditTool } = loadPi();
  const tool = createEditTool(cwd);
  return adaptPiTool(
    tool,
    operations ? (signal) => createEditTool(cwd, { operations: operations(signal) }) : undefined,
  );
}

export function createPiEdit(cwd: string, operations: (signal?: AbortSignal) => EditOperations) {
  return createTool(cwd, operations);
}

export const edit: Edit = (cwd, input, { operations, signal } = {}) =>
  createTool(cwd, operations && (() => operations)).execute(input, signal);
