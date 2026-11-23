import { EventEmitter, once } from 'node:events';
import type { Hono } from 'hono';
import { observe } from '@flue/runtime';
import {
  type ConversationActivity,
  acknowledgeConversationSchema,
  productRoutes,
} from '@workspace/protocol/host';
import { bodyLimit } from 'hono/body-limit';
import { type SSEStreamingApi, streamSSE } from 'hono/streaming';
import type { WorkspaceCatalog } from '../workspace/services.js';
import { primaryAgentName } from '../trajectory/contract.js';

const recentIdleLimit = 20;

export function observeConversationActivity(catalog: WorkspaceCatalog) {
  const running = new Map<string, { lastActivityAt: string; submissions: Set<string> }>();
  const changes = new EventEmitter().setMaxListeners(0);
  const lifetime = new AbortController();
  let current = JSON.stringify(snapshot());

  function snapshot(): ConversationActivity {
    const activity: ConversationActivity = Object.fromEntries(
      catalog
        .listActivity([...running.keys()], recentIdleLimit)
        .map(({ sessionId, lastActivityAt, unreadCompletion }) => [
          sessionId,
          { running: false, lastActivityAt, unreadCompletion },
        ]),
    );
    for (const [id, { lastActivityAt }] of running) {
      activity[id] = { ...activity[id], running: true, lastActivityAt };
    }
    return activity;
  }

  function publish() {
    const next = JSON.stringify(snapshot());
    if (next !== current) {
      current = next;
      changes.emit('change');
    }
  }

  const stopObserving = observe((event, { id }) => {
    if (
      (event.type !== 'submission_running' && event.type !== 'submission_settled') ||
      event.agentName !== primaryAgentName ||
      !event.submissionId ||
      event.taskId ||
      event.parentSession ||
      (event.harness && event.harness !== 'default') ||
      !catalog.findSession(id)
    ) {
      return;
    }

    if (event.type === 'submission_running') {
      const submissions = running.get(id)?.submissions ?? new Set<string>();
      submissions.add(event.submissionId);
      running.set(id, { lastActivityAt: event.timestamp, submissions });
      catalog.recordActivity(id, event.timestamp);
    } else {
      const active = running.get(id);
      active?.submissions.delete(event.submissionId);
      if (active?.submissions.size === 0) {
        running.delete(id);
      }
      catalog.recordActivity(
        id,
        event.timestamp,
        event.outcome === 'completed' ? event.submissionId : null,
      );
    }
    publish();
  });

  async function follow(stream: SSEStreamingApi, requestSignal: AbortSignal) {
    const disconnected = new AbortController();
    stream.onAbort(() => disconnected.abort());
    const signal = AbortSignal.any([requestSignal, disconnected.signal, lifetime.signal]);

    const abort = () => stream.abort();

    signal.addEventListener('abort', abort, { once: true });
    let sent: string | undefined;
    try {
      while (!signal.aborted) {
        if (sent !== current) {
          sent = current;
          await stream.writeSSE({ data: sent });
          continue;
        }

        // Wake on a state change. A comment keeps idle SSE connections open through proxies.
        const idle = AbortSignal.timeout(15_000);
        await once(changes, 'change', { signal: AbortSignal.any([signal, idle]) }).catch(
          async (error: unknown) => {
            if (signal.aborted) {
              return;
            }
            if (!idle.aborted) {
              throw error;
            }
            await stream.write(': keep-alive\n\n');
          },
        );
      }
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  return {
    dispose(this: void) {
      lifetime.abort();
      stopObserving();
    },
    mountRoutes(app: Hono) {
      const { conversationActivity, acknowledgeConversation } = productRoutes;
      app.on(conversationActivity.method, conversationActivity.path, (c) => {
        const response = streamSSE(c, (stream) => follow(stream, c.req.raw.signal));
        response.headers.set('Cache-Control', 'no-store, no-transform');
        return response;
      });
      app.on(
        acknowledgeConversation.method,
        acknowledgeConversation.path,
        bodyLimit({ maxSize: 512 }),
        async (c) => {
          const input = acknowledgeConversationSchema.safeParse(
            await c.req.json().catch(() => null),
          );
          if (!input.success) {
            return c.json({ error: 'Invalid completion.' }, 400);
          }
          catalog.acknowledgeCompletion(c.req.param('id'), input.data.submissionId);
          publish();
          return c.body(null, 204);
        },
      );
    },
  };
}
