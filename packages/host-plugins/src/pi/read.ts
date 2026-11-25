import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { buffer } from 'node:stream/consumers';
import * as v from 'valibot';
import { FileReadError, read } from '../filesystem/read.js';
import { adaptPiTool, loadPi } from './tool.js';

const firstLineExceedsLimit = v.object({
  truncation: v.object({ firstLineExceedsLimit: v.literal(true) }),
});

function createReadToolForCall(cwd: string, signal?: AbortSignal, onFile?: (path: string) => void) {
  const {
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_LINES,
    createReadTool,
    detectSupportedImageMimeTypeFromFile,
    formatSize,
  } = loadPi();
  const tool = createReadTool(cwd, {
    operations: {
      async access(absolutePath) {
        await access(absolutePath, constants.R_OK);
        onFile?.(absolutePath);
      },
      readFile: (absolutePath) => buffer(read({ absolutePath }, { signal })),
      createReadStream: (absolutePath, options) => read({ absolutePath }, options),
      async detectImageMimeType(absolutePath) {
        if (!(await stat(absolutePath)).isFile()) {
          throw new FileReadError('NOT_A_FILE');
        }
        if (await detectSupportedImageMimeTypeFromFile(absolutePath)) {
          throw new Error('The read tool supports text files only.');
        }
        return null;
      },
    },
  });

  return {
    parameters: tool.parameters,
    prepareArguments: tool.prepareArguments,
    description: `Read text from a file. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. Use offset and limit to continue through large files.`,
    async execute(...args: Parameters<typeof tool.execute>) {
      const result = await tool.execute(...args);
      if (v.is(firstLineExceedsLimit, result.details)) {
        return {
          content: [
            {
              type: 'text',
              text: `[The requested line exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit.]`,
            },
          ],
        };
      }
      return result;
    },
  };
}

export function createPiRead(cwd: string) {
  return adaptPiTool(createReadToolForCall(cwd), (signal, onFile) =>
    createReadToolForCall(cwd, signal, onFile),
  );
}
