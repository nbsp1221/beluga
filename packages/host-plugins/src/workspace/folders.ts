import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export class FolderError extends Error {
  readonly status: 400 | 403 | 404;

  constructor(message: string, status: 400 | 403 | 404) {
    super(message);
    this.status = status;
  }
}

function isAbsoluteHostPath(value: string) {
  if (!path.isAbsolute(value) || value.includes('\0')) {
    return false;
  }
  if (process.platform !== 'win32') {
    return true;
  }
  // Root-relative paths depend on the Host's current drive.
  return (
    /^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(value) && !/^[\\/]{2}[?.][\\/]/.test(value)
  );
}

function folderError(error: unknown): FolderError {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (code === 'EACCES' || code === 'EPERM') {
    return new FolderError('The Host cannot access this folder.', 403);
  }
  return new FolderError('Folder not found on the Host.', 404);
}

export async function resolveFolder(value: string) {
  if (!isAbsoluteHostPath(value)) {
    throw new FolderError('Enter an absolute folder path on the Host.', 400);
  }

  let folder: string;
  try {
    folder = await realpath(value);
    if ((await stat(folder)).isDirectory()) {
      return folder;
    }
  } catch (error) {
    throw folderError(error);
  }

  throw new FolderError('Choose a folder, not a file.', 400);
}

export async function browseFolders(value = homedir()) {
  const folder = await resolveFolder(value);
  const parent = path.dirname(folder);

  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return {
      path: folder,
      parent: parent === folder ? null : parent,
      folders: entries
        .filter((entry) => entry.isDirectory())
        .map(({ name }) => ({ name, path: path.join(folder, name) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } catch (error) {
    throw folderError(error);
  }
}
