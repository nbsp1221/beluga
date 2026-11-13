import type { Glob } from '../filesystem/glob.js';
import { adaptPiTool, loadPi } from './tool.js';

export function createPiGlob(cwd: string) {
  return adaptPiTool(loadPi().createFindTool(cwd));
}

export const glob: Glob = (cwd, input, signal) => createPiGlob(cwd).execute(input, signal);
