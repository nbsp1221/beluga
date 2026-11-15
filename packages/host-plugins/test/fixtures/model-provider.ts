import {
  type AssistantMessage,
  type Model,
  type Provider,
  type ToolCall,
  type ToolResultMessage,
  createAssistantMessageEventStream,
} from '@earendil-works/pi-ai';
import * as v from 'valibot';

const toolInput = v.objectWithRest(
  { tool: v.optional(v.string(), 'read') },
  v.union([
    v.string(),
    v.number(),
    v.boolean(),
    v.array(v.object({ oldText: v.string(), newText: v.string() })),
  ]),
);

export interface ModelRequest {
  model: string;
  effort: string | undefined;
  toolNames: string[];
  toolSchemas: ReadonlyMap<string, unknown>;
  result: ToolResultMessage | undefined;
  instructions: string;
}

export function fixtureProvider(
  observed: ModelRequest[],
  beforeToolCall?: (call: ToolCall) => Promise<void>,
): Provider {
  const model: Model<'openai-responses'> = {
    id: 'fixture',
    name: 'Fixture',
    provider: 'test-read',
    api: 'openai-responses',
    baseUrl: 'https://beluga.example',
    input: ['text'],
    reasoning: true,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 4_000,
  };

  const streamSimple: Provider['streamSimple'] = (selected, context, options) => {
    const text = (content: string | readonly { type: string }[]) =>
      typeof content === 'string'
        ? content
        : content
            .flatMap((part) =>
              part.type === 'text' && 'text' in part && typeof part.text === 'string'
                ? [part.text]
                : [],
            )
            .join('');

    const latest = context.messages.findLast(
      (message) => message.role === 'user' && text(message.content).startsWith('{'),
    );
    const prior = context.messages.findLast(
      (message) =>
        message === latest || message.role === 'toolResult' || message.role === 'assistant',
    );

    const tools = new Map<string, unknown>();
    const instructions: string[] = [];
    for (const message of context.messages) {
      if (message.role !== 'system') {
        continue;
      }
      instructions.push(text(message.content));
      for (const tool of message.toolsRemoved ?? []) {
        tools.delete(tool.name);
      }
      for (const tool of message.toolsAdded ?? []) {
        tools.set(tool.name, tool.parameters);
      }
    }

    observed.push({
      model: selected.id,
      effort: options?.reasoning,
      toolNames: [...tools.keys()],
      toolSchemas: tools,
      result: prior?.role === 'toolResult' ? prior : undefined,
      instructions: instructions.join('\n'),
    });

    const input: unknown = latest?.role === 'user' ? JSON.parse(text(latest.content)) : {};
    const { tool, ...args } = v.parse(toolInput, input);
    const call: ToolCall | undefined =
      latest && tools.has(tool) && prior?.role !== 'toolResult'
        ? { type: 'toolCall', id: `tool-${crypto.randomUUID()}`, name: tool, arguments: args }
        : undefined;
    const stopReason = call ? 'toolUse' : 'stop';
    const message: AssistantMessage = {
      role: 'assistant',
      content: call ? [call] : [{ type: 'text', text: 'Fixture complete.' }],
      api: selected.api,
      provider: selected.provider,
      model: selected.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { ...model.cost, total: 0 },
      },
      stopReason,
      timestamp: Date.now(),
    };

    const stream = createAssistantMessageEventStream();

    function publish() {
      stream.push({ type: 'start', partial: message });
      if (call) {
        stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall: call, partial: message });
      }
      stream.push({ type: 'done', reason: stopReason, message });
    }

    if (call && beforeToolCall) {
      void beforeToolCall(call).then(publish, (error: unknown) => {
        stream.push({
          type: 'error',
          reason: 'error',
          error: { ...message, stopReason: 'error', errorMessage: String(error) },
        });
      });
    } else {
      publish();
    }
    return stream;
  };

  return {
    id: model.provider,
    name: model.name,
    getModels: () => [model, { ...model, id: 'alternate' }],
    auth: {
      apiKey: {
        name: 'Fixture key',
        resolve: () => Promise.resolve({ type: 'api_key', auth: { apiKey: 'fixture' } }),
      },
    },
    stream: (selected, context) => streamSimple(selected, context),
    streamSimple,
  };
}
