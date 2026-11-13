import { defineTool } from '@flue/runtime';
import * as v from 'valibot';

interface AgentTool<Input> {
  description: string;
  schema: Record<string, unknown>;
  parse(input: unknown): Input | undefined;
  execute(input: Input, signal: AbortSignal | undefined, toolCallId: string): Promise<string>;
}

export function bindAgentTool<Input>(
  name: string,
  tool: AgentTool<Input>,
  authorize: () => Promise<void>,
) {
  return defineTool({
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
      return tool.execute(input, signal, toolCallId);
    },
  });
}
