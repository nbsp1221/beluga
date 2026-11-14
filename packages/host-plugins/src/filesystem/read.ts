import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';

export type FileTarget = Readonly<{ absolutePath: string }>;

type FileReadErrorCode = 'NOT_FOUND' | 'NOT_A_FILE' | 'ACCESS_DENIED' | 'ABORTED' | 'READ_FAILED';

export class FileReadError extends Error {
  readonly code: FileReadErrorCode;

  constructor(code: FileReadErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = 'FileReadError';
    this.code = code;
  }
}

export async function* read(
  target: FileTarget,
  { signal }: { signal?: AbortSignal } = {},
): AsyncGenerator<Uint8Array> {
  try {
    signal?.throwIfAborted();
    if (!(await stat(target.absolutePath)).isFile()) {
      throw new FileReadError('NOT_A_FILE');
    }
    // On POSIX, avoid waiting on a FIFO if the path changes before open.
    const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK);
    const file = await open(target.absolutePath, flags);
    try {
      if (!(await file.stat()).isFile()) {
        throw new FileReadError('NOT_A_FILE');
      }
      yield* file.createReadStream({ autoClose: false, signal });
    } finally {
      await file.close();
    }
  } catch (error) {
    if (signal?.aborted) {
      throw new FileReadError('ABORTED', error);
    }
    if (error instanceof FileReadError) {
      throw error;
    }
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    switch (code) {
      case 'ENOENT':
      case 'ENOTDIR':
        throw new FileReadError('NOT_FOUND', error);
      case 'EISDIR':
        throw new FileReadError('NOT_A_FILE', error);
      case 'EACCES':
      case 'EPERM':
        throw new FileReadError('ACCESS_DENIED', error);
      default:
        throw new FileReadError('READ_FAILED', error);
    }
  }
}
