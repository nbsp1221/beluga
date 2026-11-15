import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export function denied() {
  return new Error('File changes require a path inside the workspace, without links.');
}

export function workspaceSegments(root: string, target: string) {
  const relative = path.relative(root, target);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) {
    throw denied();
  }
  const segments = relative ? relative.split(path.sep) : [];
  if (
    target.includes('\0') ||
    (process.platform === 'win32' &&
      segments.some(
        (name) =>
          /[:<>"|?*]|[. ]$/.test(name) ||
          /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name),
      ))
  ) {
    throw denied();
  }
  return segments;
}

export async function inspectDirectory(directory: string) {
  const info = await lstat(directory, { bigint: true });
  if (!info.isDirectory() || path.relative(directory, await realpath(directory))) {
    throw denied();
  }
  return info;
}

export async function inspectFile(file: string) {
  const info = await lstat(file, { bigint: true });
  if (!info.isFile() || info.nlink !== 1n || path.relative(file, await realpath(file))) {
    throw denied();
  }
  return info;
}

export function missing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
