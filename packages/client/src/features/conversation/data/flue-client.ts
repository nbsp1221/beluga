import { type FlueConversationPart, type FlueConversationState, createFlueClient } from '@flue/sdk';
import { CONVERSATION_PATH } from '@workspace/protocol/host';
import type { AssistantMessagePart, Message, TurnActivity } from '../contract.js';

export function connectConversation(id: string, fetchHost: typeof fetch, prefix = '') {
  const url = new URL(
    `${prefix}${CONVERSATION_PATH}/${encodeURIComponent(id)}`,
    window.location.origin,
  );
  return createFlueClient({ url: url.href, fetch: fetchHost });
}

function isChatPart(
  part: FlueConversationPart,
): part is Extract<FlueConversationPart, { type: 'text' | 'reasoning' | 'dynamic-tool' }> {
  return (
    part.type === 'dynamic-tool' ||
    ((part.type === 'text' || part.type === 'reasoning') && Boolean(part.text.trim()))
  );
}

export function conversationMessages(
  { messages, settlements }: FlueConversationState,
  runningId?: string,
): Message[] {
  const visible = messages.filter((message) => message.display === 'visible');
  const starts = new Map<string, number | undefined>();
  const responses = new Set<string>();
  for (const { role, submissionId, timestamp } of visible) {
    if (!submissionId) {
      continue;
    }
    if (role === 'user' && !starts.has(submissionId)) {
      starts.set(submissionId, captureTime(timestamp));
    } else if (role === 'assistant') {
      responses.add(submissionId);
    }
  }
  const results = new Map(settlements.map((result) => [result.submissionId, result]));

  function activityFor(
    id: string,
    outcome: (typeof settlements)[number]['outcome'] | undefined,
    endedAt: number | undefined,
  ): TurnActivity | undefined {
    const startedAt = starts.get(id);
    if (!outcome) {
      return id === runningId ? { state: 'running', startedAt } : undefined;
    }
    const durationMs =
      startedAt !== undefined && endedAt !== undefined && endedAt >= startedAt
        ? endedAt - startedAt
        : undefined;
    return { state: outcome, durationMs };
  }

  return visible.flatMap<Message>((message) => {
    const result = message.submissionId ? results.get(message.submissionId) : undefined;
    const endedAt = captureTime(result?.timestamp);
    const activity = message.submissionId
      ? activityFor(message.submissionId, result?.outcome, endedAt)
      : undefined;
    const responseId = message.submissionId ? `turn:${message.submissionId}` : message.id;

    if (message.role === 'user') {
      const text = message.parts
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('');
      const rows: Message[] = text
        ? [{ id: message.id, role: 'user', text, sentAt: captureTime(message.timestamp) }]
        : [];
      if (
        activity &&
        activity.state !== 'completed' &&
        message.submissionId &&
        !responses.has(message.submissionId)
      ) {
        rows.push({ id: responseId, role: 'assistant', parts: [], activity });
      }
      return rows;
    }
    if (message.role !== 'assistant') {
      return [];
    }

    const running = activity?.state === 'running';
    const parts: AssistantMessagePart[] = [];
    for (const [sourceIndex, part] of message.parts.entries()) {
      if (!isChatPart(part)) {
        continue;
      }

      if (part.type !== 'dynamic-tool') {
        // Text and reasoning have no SDK id. Their unfiltered slot survives new deltas.
        parts.push({
          type: part.type,
          id: `${message.id}:${sourceIndex}`,
          text: part.text,
          streaming: running && part.state === 'streaming',
        });
        continue;
      }

      const status =
        part.state === 'input-available'
          ? running
            ? 'running'
            : 'incomplete'
          : part.state === 'output-error'
            ? 'failed'
            : 'completed';
      parts.push({
        type: 'tool',
        id: part.toolCallId,
        name: part.toolName,
        input: part.input,
        status,
        output: part.output,
        error: part.errorText,
      });
    }

    return parts.length || activity
      ? [
          {
            id: responseId,
            role: 'assistant',
            parts,
            activity,
            completedAt: result?.outcome === 'completed' ? endedAt : undefined,
          },
        ]
      : [];
  });
}

function captureTime(timestamp?: string) {
  const time = timestamp === undefined ? NaN : Date.parse(timestamp);
  return Number.isFinite(time) ? time : undefined;
}

export function activeSubmissionId({ messages, settlements }: FlueConversationState) {
  const settled = new Set(settlements.map(({ submissionId }) => submissionId));
  return messages.findLast(
    (message) =>
      message.role === 'user' &&
      message.display === 'visible' &&
      message.submissionId &&
      !settled.has(message.submissionId),
  )?.submissionId;
}
