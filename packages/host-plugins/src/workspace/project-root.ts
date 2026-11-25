import { dirname, join, relative } from 'node:path';
import type { WorkspaceFiles } from './services.js';

export async function resolveProjectRoot(
  files: Pick<WorkspaceFiles, 'realpath' | 'stat'>,
  cwd: string,
  markers: readonly string[] = ['.git'],
  signal?: AbortSignal,
) {
  if (relative(cwd, await files.realpath(cwd))) {
    throw new Error('The registered workspace now points to a different folder.');
  }
  for (let directory = cwd; ; directory = dirname(directory)) {
    signal?.throwIfAborted();
    for (const marker of markers) {
      const found = await files.stat(join(directory, marker)).catch((error: unknown) => {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')
        ) {
          throw error;
        }
      });
      if (found) {
        return directory;
      }
    }
    if (dirname(directory) === directory) {
      return cwd;
    }
  }
}
