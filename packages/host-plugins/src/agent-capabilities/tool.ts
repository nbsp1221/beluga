import { defineTool } from '@flue/runtime';
import * as v from 'valibot';

interface AgentTool<Input> {
  description: string;
  schema: Record<string, unknown>;
  parse(input: unknown): Input | undefined;
  execute(
    input: Input,
    signal: AbortSignal | undefined,
    toolCallId: string,
    onFile?: (path: string) => void,
  ): Promise<string>;
}

export type OnFiles = (
  paths: readonly string[],
  toolCallId: string,
  signal?: AbortSignal,
) => Promise<void>;

export class AgentToolRegistration {
  private readonly connect: (
    authorize: () => Promise<void>,
    onFiles?: OnFiles,
  ) => ReturnType<typeof defineTool>;

  private constructor(connect: AgentToolRegistration['connect']) {
    this.connect = connect;
  }

  static create<Input>(name: string, tool: AgentTool<Input>) {
    return new AgentToolRegistration((authorize, onFiles) =>
      defineTool({
        name,
        description: tool.description,
        // Flue uses Valibot for transport; the adapter supplies the model-visible schema.
        input: v.pipe(v.looseObject({}), v.metadata(tool.schema)),
        async run({ data, signal, toolCallId }) {
          const input = tool.parse(data);
          if (input === undefined) {
            throw new Error(`Invalid arguments for ${name}.`);
          }
          signal?.throwIfAborted();
          await authorize();
          if (!onFiles) {
            return tool.execute(input, signal, toolCallId);
          }
          const paths = new Set<string>();
          const output = await tool.execute(input, signal, toolCallId, (path) => paths.add(path));
          if (paths.size > 0 && !signal?.aborted) {
            await onFiles([...paths], toolCallId, signal);
          }
          return output;
        },
      }),
    );
  }

  bind(authorize: () => Promise<void>, onFiles?: OnFiles) {
    return this.connect(authorize, onFiles);
  }
}
