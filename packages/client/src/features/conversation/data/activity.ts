import {
  CONVERSATION_ACTIVITY_PATH,
  CONVERSATION_PATH,
  type ConversationActivity,
  conversationActivitySchema,
} from '@workspace/protocol/host';
import { EventSource } from 'eventsource';
import type { HostRequest } from '../../../transport/host-http.js';
import { createStore } from '../../../state/store.js';

export function createConversationActivity(
  signal: AbortSignal,
  fetchHost: typeof fetch,
  request: HostRequest,
) {
  const { getSnapshot, subscribe, publish } = createStore<ConversationActivity>({});

  return {
    getSnapshot,
    subscribe,
    observe() {
      const url = new URL(CONVERSATION_ACTIVITY_PATH, window.location.origin);
      const stream = new EventSource(url, {
        async fetch(input, init) {
          const response = await fetchHost(input, init);
          // An unavailable proxy or Host is a reconnectable transport failure.
          if (response.status >= 500) {
            await response.body?.cancel();
            throw new Error(`Conversation status stream: HTTP ${response.status}`);
          }
          return response;
        },
      });

      const close = () => {
        stream.close();
        signal.removeEventListener('abort', close);
        publish({});
      };

      stream.onmessage = ({ data }: MessageEvent<string>) => {
        try {
          publish(conversationActivitySchema.parse(JSON.parse(data)));
        } catch {
          close();
        }
      };
      stream.onerror = () => publish({});
      signal.addEventListener('abort', close, { once: true });
      if (signal.aborted) {
        close();
      }

      return close;
    },
    async acknowledge(id: string, submissionId: string) {
      await request(`${CONVERSATION_PATH}/${encodeURIComponent(id)}/read`, { submissionId }, 'PUT');
    },
  };
}
