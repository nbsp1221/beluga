import type { Grep } from '../filesystem/grep.js';
import { adaptPiTool, loadPi } from './tool.js';

export function createPiGrep(cwd: string) {
  return adaptPiTool(loadPi().createGrepTool(cwd));
}

export const grep: Grep = (cwd, input, signal) => createPiGrep(cwd).execute(input, signal);
