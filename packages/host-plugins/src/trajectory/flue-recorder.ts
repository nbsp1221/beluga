import { AsyncLocalStorage } from 'node:async_hooks';
import type { Provider } from '@earendil-works/pi-ai';
import { type FlueObservation, type FlueObservationSubscriber, instrument } from '@flue/runtime';
import {
  type TrajectoryRecord,
  conversationFailureMessage,
  skillInvocationAttributesSchema,
  skillInvocationSignal,
  workspaceInstructionChanges,
} from '@workspace/protocol/host';
import * as v from 'valibot';
import type { TrajectoryStore } from './store.js';
import { primaryAgentName } from './contract.js';

const recordedEvents = new Set([
  'submission_running',
  'submission_settled',
  'turn_start',
  'turn_request',
  'turn',
  'text_delta',
  'thinking_delta',
  'toolcall_delta',
  'tool_start',
  'tool',
  'compaction_start',
  'compaction',
]);

type ToolSchemasByModel = Map<string, ReadonlyMap<string, unknown>>;

interface SubmissionTools {
  schemasByModel: ToolSchemasByModel;
  inputsByCall: Map<string, unknown>;
}

interface ObservationOptions {
  ownsSession: (id: string) => boolean;
  selection: (id: string) => { model: string; revision: number } | undefined;
  contextWindow: (providerId: string, modelId: string) => number | undefined;
  reportFailure: (error: unknown) => void;
}

interface SubmissionContext {
  selection: ReturnType<ObservationOptions['selection']>;
  compactionId?: string;
}

interface PreparedInput {
  session: string;
  submission: string;
  event: Extract<FlueObservation, { type: 'turn_request' }>;
}

function isOutputDelta(type: FlueObservation['type']) {
  return type === 'text_delta' || type === 'thinking_delta' || type === 'toolcall_delta';
}

function errorText(value: unknown) {
  return typeof value === 'string'
    ? value
    : value && typeof value === 'object' && 'message' in value && typeof value.message === 'string'
      ? value.message
      : undefined;
}

const contextMessage = v.object({
  contextSignal: v.object({
    type: v.picklist(['agent-instructions', skillInvocationSignal]),
    content: v.string(),
    attributes: v.record(v.string(), v.string()),
  }),
});

function appliedContexts(
  messages: readonly unknown[],
  modelRequestId: string,
  timestamp: string,
): Extract<TrajectoryRecord, { kind: 'context' }>[] {
  return messages.flatMap((message) => {
    const parsed = v.safeParse(contextMessage, message);
    if (!parsed.success) {
      return [];
    }
    const { content, attributes, type } = parsed.output.contextSignal;
    if (type === skillInvocationSignal) {
      const skill = skillInvocationAttributesSchema.safeParse(attributes).data;
      return skill
        ? [
            {
              kind: 'context',
              id: `context:${skill.id}`,
              modelRequestId,
              timestamp,
              text: skill.name,
              body: content,
              changes: [],
              skill: { name: skill.name, scope: skill.scope },
            },
          ]
        : [];
    }
    const changes = workspaceInstructionChanges(attributes.changes);
    if (!attributes.id || !changes?.length) {
      return [];
    }
    return [
      {
        kind: 'context',
        id: `context:${attributes.id}`,
        modelRequestId,
        timestamp,
        text: changes.map(({ path }) => path).join(', '),
        body: content,
        changes,
      },
    ];
  });
}

export function observeFlueTrajectory(store: TrajectoryStore, options: ObservationOptions) {
  const toolsBySubmission = new Map<string, SubmissionTools>();
  const outputTurnsBySubmission = new Map<string, Set<string>>();
  const contextBySubmission = new Map<string, SubmissionContext>();
  const preparedInputs = new Map<string, PreparedInput>();
  const modelExecution = new AsyncLocalStorage<string>();

  function confirmInput(providerId: string, signal?: AbortSignal) {
    const turnId = modelExecution.getStore();
    if (!turnId || signal?.aborted) {
      return;
    }
    const prepared = preparedInputs.get(turnId);
    if (prepared?.event.request.providerId !== providerId) {
      return;
    }
    preparedInputs.delete(turnId);
    const { session, submission, event } = prepared;
    const submissionKey = `${session}/${submission}`;

    try {
      const modelId = `model:${turnId}`;
      const tools = toolsBySubmission.get(submissionKey) ?? {
        schemasByModel: new Map(),
        inputsByCall: new Map(),
      };
      const { input } = event.request;
      const ordinary = event.purpose === 'agent';
      store.putModelInput(
        session,
        submission,
        modelId,
        event.timestamp,
        {
          systemPrompt: input.systemPrompt,
          messages: input.messages.map((message) => {
            if (!('contextSignal' in message)) {
              return message;
            }
            const { contextSignal: _source, ...modelMessage } = message;
            return modelMessage;
          }),
          tools: input.tools ?? [],
        },
        ordinary,
        ordinary ? appliedContexts(input.messages, modelId, event.timestamp) : [],
      );
      tools.schemasByModel.set(
        modelId,
        new Map(input.tools?.map((tool) => [tool.name, tool.parameters])),
      );
      toolsBySubmission.set(submissionKey, tools);
    } catch (error) {
      options.reportFailure(error);
    }
  }

  const observe: FlueObservationSubscriber = (event, context) => {
    if (
      !recordedEvents.has(event.type) ||
      ((event.type === 'submission_running' || event.type === 'submission_settled') &&
        event.kind === 'dispatch') ||
      event.agentName !== primaryAgentName ||
      !event.submissionId ||
      event.taskId ||
      event.parentSession ||
      (event.harness && event.harness !== 'default')
    ) {
      return;
    }

    const submissionKey = `${context.id}/${event.submissionId}`;
    const isOutput = isOutputDelta(event.type);
    if (
      isOutput &&
      (!event.turnId || outputTurnsBySubmission.get(submissionKey)?.has(event.turnId))
    ) {
      return;
    }
    if (!options.ownsSession(context.id)) {
      return;
    }

    try {
      if (event.type === 'submission_running') {
        contextBySubmission.set(submissionKey, { selection: options.selection(context.id) });
      } else if (event.type === 'turn_request') {
        preparedInputs.set(event.turnId, {
          session: context.id,
          submission: event.submissionId,
          event,
        });
      }
      capture(
        store,
        toolsBySubmission,
        context.id,
        event.submissionId,
        event,
        contextBySubmission.get(submissionKey),
        options.contextWindow,
      );
      if (isOutput && event.turnId) {
        const seen = outputTurnsBySubmission.get(submissionKey) ?? new Set<string>();
        seen.add(event.turnId);
        outputTurnsBySubmission.set(submissionKey, seen);
      }
    } catch (error) {
      options.reportFailure(error);
    } finally {
      if (event.type === 'turn') {
        preparedInputs.delete(event.turnId);
      } else if (event.type === 'submission_settled') {
        for (const [turnId, { session, submission }] of preparedInputs) {
          if (session === context.id && submission === event.submissionId) {
            preparedInputs.delete(turnId);
          }
        }
        toolsBySubmission.delete(submissionKey);
        outputTurnsBySubmission.delete(submissionKey);
        contextBySubmission.delete(submissionKey);
      }
    }
  };

  const dispose = instrument({
    observe,
    interceptor(operation, _context, next) {
      return operation.type === 'model' ? modelExecution.run(operation.turnId, next) : next();
    },
    dispose() {},
  });

  return {
    dispose,
    observeProvider(this: void, provider: Provider): Provider {
      const { apiKey } = provider.auth;
      return {
        ...provider,
        auth: {
          ...provider.auth,
          ...(apiKey && {
            apiKey: {
              ...apiKey,
              resolve(input) {
                // Pi enters the credential resolver after Flue allows execution.
                confirmInput(provider.id, input.signal);
                return apiKey.resolve(input);
              },
            },
          }),
        },
        stream(model, context, options) {
          confirmInput(provider.id, options?.signal);
          return provider.stream(model, context, options);
        },
        streamSimple(model, context, options) {
          confirmInput(provider.id, options?.signal);
          return provider.streamSimple(model, context, options);
        },
      };
    },
  };
}

function capture(
  store: TrajectoryStore,
  toolsBySubmission: Map<string, SubmissionTools>,
  session: string,
  submission: string,
  event: FlueObservation,
  context: SubmissionContext | undefined,
  contextWindow: ObservationOptions['contextWindow'],
) {
  const modelId = event.turnId && `model:${event.turnId}`;
  const submissionKey = `${session}/${submission}`;
  const model = modelId ? store.get(session, submission, modelId) : undefined;
  const tools = toolsBySubmission.get(submissionKey);

  if (event.type === 'submission_running') {
    store.ensure(session, submission);
  } else if (event.type === 'submission_settled') {
    if (context?.compactionId) {
      const record = store.get(session, submission, context.compactionId);
      if (record?.kind === 'compaction' && record.status === 'in-progress') {
        store.put(session, submission, {
          ...record,
          status: 'interrupted',
          endedAt: event.timestamp,
        });
      }
    }
    store.settle(
      session,
      submission,
      event.outcome === 'aborted' ? 'interrupted' : event.outcome,
      event.timestamp,
      event.outcome === 'failed'
        ? (conversationFailureMessage(event.error) ?? 'The run failed.')
        : undefined,
    );
  } else if (event.type === 'compaction_start' && context) {
    const id = `compaction:${crypto.randomUUID()}`;
    context.compactionId = id;
    store.put(session, submission, {
      kind: 'compaction',
      id,
      text: 'Context compaction',
      reason: event.reason,
      timestamp: event.timestamp,
      estimatedTokens: event.estimatedTokens,
      status: 'in-progress',
    });
  } else if (event.type === 'compaction' && context?.compactionId) {
    const record = store.get(session, submission, context.compactionId);
    context.compactionId = undefined;
    if (record?.kind === 'compaction') {
      const interrupted =
        event.errorInfo?.type === 'AbortError' || event.errorInfo?.type === 'submission_aborted';
      store.put(session, submission, {
        ...record,
        endedAt: event.timestamp,
        durationMs: event.durationMs,
        messagesBefore: event.messagesBefore,
        messagesAfter: event.messagesAfter,
        summaryTokens: event.usage?.totalTokens,
        status: interrupted ? 'interrupted' : event.isError ? 'failed' : 'completed',
        error: errorText(event.error),
      });
    }
  } else if (event.type === 'turn_start' && modelId && !model) {
    store.put(session, submission, {
      kind: 'assistant',
      id: modelId,
      text: '',
      timestamp: event.timestamp,
      purpose: event.purpose,
      status: 'in-progress',
    });
  } else if (event.type === 'turn_request' && modelId) {
    const { providerId, requestedModel, contextCompacted } = event.request;
    const ordinary = event.purpose === 'agent';
    const selection = context?.selection;
    const window =
      ordinary && selection?.model === `${providerId}/${requestedModel}`
        ? contextWindow(providerId, requestedModel)
        : undefined;
    store.put(session, submission, {
      kind: 'assistant',
      id: modelId,
      text: '',
      timestamp: model?.timestamp ?? event.timestamp,
      model: event.request.requestedModel,
      provider: event.request.providerName,
      purpose: event.purpose,
      compactionId: ordinary ? undefined : context?.compactionId,
      contextCompacted,
      contextSample:
        selection && window && Number.isSafeInteger(window) && window > 0
          ? { ...selection, contextWindow: window }
          : undefined,
      status: 'in-progress',
    });
  } else if (isOutputDelta(event.type) && model?.kind === 'assistant' && !model.firstOutputAt) {
    store.put(session, submission, { ...model, firstOutputAt: event.timestamp });
  } else if (event.type === 'turn' && model?.kind === 'assistant') {
    const content = event.response.output?.content ?? [];
    for (const part of content) {
      if (part.type === 'toolCall') {
        tools?.inputsByCall.set(part.id, part.arguments);
      }
    }
    const reported = event.response.usage;
    const inputTokens = reported ? reported.input + reported.cacheRead + reported.cacheWrite : 0;
    const usage =
      event.response.usage &&
      Object.fromEntries(
        Object.entries(event.response.usage).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === 'number' && Number.isFinite(entry[1]),
        ),
      );
    store.put(session, submission, {
      ...model,
      text: content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(''),
      endedAt: event.timestamp,
      durationMs: event.durationMs,
      status:
        event.response.finishReason === 'aborted'
          ? 'interrupted'
          : event.isError
            ? 'failed'
            : 'completed',
      usage,
      contextSample:
        model.contextSample &&
        !event.isError &&
        event.response.finishReason !== 'aborted' &&
        Number.isSafeInteger(inputTokens) &&
        inputTokens > 0
          ? { ...model.contextSample, inputTokens }
          : undefined,
    });
  } else if (event.type === 'tool_start') {
    // Rejected calls may have no validated args in tool_start.
    const input: unknown = tools?.inputsByCall.get(event.toolCallId) ?? event.args;
    tools?.inputsByCall.delete(event.toolCallId);
    store.put(session, submission, {
      kind: 'tool',
      id: `tool:${event.toolCallId}`,
      name: event.toolName,
      modelRequestId: modelId,
      timestamp: event.timestamp,
      input,
      schema: modelId ? tools?.schemasByModel.get(modelId)?.get(event.toolName) : undefined,
      status: 'in-progress',
    });
  } else if (event.type === 'tool') {
    const record = store.get(session, submission, `tool:${event.toolCallId}`);
    if (record?.kind !== 'tool') {
      return;
    }
    const output = event.result;
    store.put(session, submission, {
      ...record,
      output,
      endedAt: event.timestamp,
      durationMs: event.durationMs,
      status: event.isError ? 'failed' : 'completed',
      error: errorText(event.errorInfo) ?? (event.isError ? errorText(output) : undefined),
    });
  }
}
