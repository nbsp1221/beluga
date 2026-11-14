import type { Write, WriteOperations } from '../filesystem/write.js';
import { adaptPiTool, loadPi } from './tool.js';

function createTool(cwd: string, operations?: (signal?: AbortSignal) => WriteOperations) {
  const { createWriteTool } = loadPi();
  const tool = createWriteTool(cwd);
  return adaptPiTool(
    tool,
    operations ? (signal) => createWriteTool(cwd, { operations: operations(signal) }) : undefined,
  );
}

export function createPiWrite(cwd: string, operations: (signal?: AbortSignal) => WriteOperations) {
  return createTool(cwd, operations);
}

export const write: Write = (cwd, input, { operations, signal } = {}) =>
  createTool(cwd, operations && (() => operations)).execute(input, signal);
