import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type * as Pi from '@earendil-works/pi-coding-agent';
import type { Static, TSchema } from 'typebox';
import { Check } from 'typebox/value';

const piEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'));
const requirePi: (entry: string) => typeof Pi = createRequire(import.meta.url);

export function loadPi() {
  // Flue renders tools synchronously, and Pi exposes its entry through the import condition.
  return requirePi(piEntry);
}

interface TextResult {
  content: readonly { type: string }[];
  isError?: boolean;
}

interface PiTool<Schema extends TSchema> {
  description: string;
  parameters: Schema;
  prepareArguments?(input: unknown): Static<Schema>;
  execute(id: string, input: Static<Schema>, signal?: AbortSignal): Promise<TextResult>;
}

export function adaptPiTool<Schema extends TSchema>(
  tool: PiTool<Schema>,
  forCall: (signal?: AbortSignal) => PiTool<Schema> = () => tool,
) {
  return {
    description: tool.description,
    get schema() {
      return structuredClone(Object.fromEntries<unknown>(Object.entries(tool.parameters)));
    },
    parse(data: unknown): Static<Schema> | undefined {
      const input = tool.prepareArguments ? tool.prepareArguments(structuredClone(data)) : data;
      return Check(tool.parameters, input) ? input : undefined;
    },
    async execute(input: Static<Schema>, signal?: AbortSignal, toolCallId = '') {
      const { content, isError } = await forCall(signal).execute(toolCallId, input, signal);
      const output = content
        .map((part) => {
          if (part.type !== 'text' || !('text' in part) || typeof part.text !== 'string') {
            throw new Error('This tool connection supports text results only.');
          }
          return part.text;
        })
        .join('\n');
      if (isError) {
        throw new Error(output);
      }
      return output;
    },
  };
}
