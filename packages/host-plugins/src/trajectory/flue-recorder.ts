import { type FlueObservation, observe } from '@flue/runtime';
import type { TrajectoryStore } from './store.js';

const recordedEvents = new Set([
  'submission_running',
  'submission_settled',
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

export function observeFlueTrajectory(store: TrajectoryStore, options: ObservationOptions) {
  const toolsBySubmission = new Map<string, SubmissionTools>();
  const outputTurnsBySubmission = new Map<string, Set<string>>();
  const contextBySubmission = new Map<string, SubmissionContext>();

  return observe((event, context) => {
    if (
      !recordedEvents.has(event.type) ||
      event.agentName !== 'BelugaPresetAgent' ||
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
      if (event.type === 'submission_settled') {
        outputTurnsBySubmission.delete(submissionKey);
        contextBySubmission.delete(submissionKey);
      } else if (isOutput && event.turnId) {
        const seen = outputTurnsBySubmission.get(submissionKey) ?? new Set<string>();
        seen.add(event.turnId);
        outputTurnsBySubmission.set(submissionKey, seen);
      }
    } catch (error) {
      options.reportFailure(error);
    }
  });
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
    toolsBySubmission.delete(submissionKey);
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
      event.outcome === 'failed' ? 'The run failed.' : undefined,
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
  } else if (event.type === 'turn_request' && modelId) {
    const { providerId, requestedModel, contextCompacted } = event.request;
    const ordinary = event.purpose === 'agent';
    const selection = context?.selection;
    const window =
      ordinary && selection?.model === `${providerId}/${requestedModel}`
        ? contextWindow(providerId, requestedModel)
        : undefined;
    const current = tools ?? { schemasByModel: new Map(), inputsByCall: new Map() };
    current.schemasByModel.set(
      modelId,
      new Map(event.request.input.tools?.map((tool) => [tool.name, tool.parameters])),
    );
    toolsBySubmission.set(submissionKey, current);

    store.putModelInput(
      session,
      submission,
      modelId,
      event.timestamp,
      {
        systemPrompt: event.request.input.systemPrompt,
        messages: event.request.input.messages,
        tools: event.request.input.tools ?? [],
      },
      ordinary,
    );
    store.put(session, submission, {
      kind: 'assistant',
      id: modelId,
      text: '',
      timestamp: event.timestamp,
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
