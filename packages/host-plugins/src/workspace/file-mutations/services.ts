import type { EditOperations } from '../../filesystem/edit.js';
import type { WriteOperations } from '../../filesystem/write.js';

type FileAccessPolicy = (
  root: string,
  checkPermission: () => void,
  signal?: AbortSignal,
) => EditOperations & WriteOperations;

declare module '@workspace/runtime' {
  interface Services {
    fileAccessPolicy: FileAccessPolicy;
  }
}
