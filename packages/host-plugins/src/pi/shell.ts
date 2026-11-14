import type { RunShell } from '../process/shell.js';
import { adaptPiTool, loadPi } from './tool.js';

const windows = process.platform === 'win32';
export const shellName = windows ? 'pwsh' : 'bash';

let shell: { exec: RunShell } | undefined;

function shellOperations() {
  const { createLocalBashOperations, createLocalPowerShellOperations, getShellConfig } = loadPi();
  return windows
    ? createLocalPowerShellOperations()
    : createLocalBashOperations({ shellPath: getShellConfig().shell });
}

export const runShell: RunShell = (command, cwd, options) => {
  shell ??= shellOperations();
  return shell.exec(command, cwd, options);
};

export function createPiShell(cwd: string, checkPermission: () => void) {
  const { createBashTool, createPowerShellTool } = loadPi();
  const createTool = windows ? createPowerShellTool : createBashTool;
  return adaptPiTool(
    createTool(cwd, {
      operations: { exec: runShell },
      spawnHook(context) {
        checkPermission();
        return context;
      },
    }),
  );
}
