import { type BigIntStats, constants } from 'node:fs';
import { access, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { denied, inspectDirectory, inspectFile, missing, workspaceSegments } from './paths.js';

function sameEntry(a: BigIntStats, b: BigIntStats) {
  return a.dev === b.dev && a.ino === b.ino;
}

// Pi owns write/edit behavior and its per-file queue. These operations guard the resolved OS paths.
export function workspaceMutationOperations(
  root: string,
  checkPermission: () => void,
  signal?: AbortSignal,
) {
  function authorize() {
    signal?.throwIfAborted();
    checkPermission();
  }

  async function directory(target: string, create = false) {
    const segments = workspaceSegments(root, target);
    const base = await inspectDirectory(root);
    let current = root;
    let info = base;
    for (const segment of segments) {
      current = path.join(current, segment);
      try {
        info = await inspectDirectory(current);
      } catch (error) {
        if (!create || !missing(error)) {
          throw error;
        }
        authorize();
        try {
          await mkdir(current);
        } catch (mkdirError) {
          if (
            !(mkdirError instanceof Error && 'code' in mkdirError && mkdirError.code === 'EEXIST')
          ) {
            throw mkdirError;
          }
        }
        info = await inspectDirectory(current);
      }
      if (info.dev !== base.dev) {
        throw denied();
      }
    }
    return info;
  }

  async function fileParent(file: string) {
    if (!workspaceSegments(root, file).length) {
      throw denied();
    }
    return directory(path.dirname(file));
  }

  function workspaceFile(target: string) {
    return path.join(root, ...workspaceSegments(root, target));
  }

  async function openFile(target: string, write: boolean) {
    authorize();
    const file = workspaceFile(target);
    const parent = await fileParent(file);
    const original = await inspectFile(file).catch((error: unknown) => {
      if (write && missing(error)) {
        return undefined;
      }
      throw error;
    });
    if (original && original.dev !== parent.dev) {
      throw denied();
    }

    authorize();
    // Never truncate on open. Verify the opened handle before changing existing data.
    const noFollow = constants.O_NOFOLLOW | constants.O_NONBLOCK;
    const flags = write
      ? constants.O_WRONLY | noFollow | (original ? 0 : constants.O_CREAT | constants.O_EXCL)
      : constants.O_RDONLY | noFollow;
    const handle = await open(file, flags);
    try {
      const [opened, current, currentParent] = await Promise.all([
        handle.stat({ bigint: true }),
        inspectFile(file),
        fileParent(file),
      ]);
      if (
        opened.nlink !== 1n ||
        !sameEntry(opened, current) ||
        (original && !sameEntry(opened, original)) ||
        !sameEntry(parent, currentParent)
      ) {
        throw denied();
      }
      authorize();
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  return {
    async mkdir(target: string) {
      authorize();
      await directory(target, true);
    },
    async access(target: string) {
      authorize();
      const file = workspaceFile(target);
      const parent = await fileParent(file);
      if ((await inspectFile(file)).dev !== parent.dev) {
        throw denied();
      }
      await access(file, constants.R_OK | constants.W_OK);
    },
    async readFile(file: string) {
      const handle = await openFile(file, false);
      try {
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    },
    async writeFile(file: string, content: string) {
      const handle = await openFile(file, true);
      try {
        authorize();
        await handle.truncate();
        await handle.writeFile(content, 'utf8');
      } finally {
        await handle.close();
      }
    },
  };
}
