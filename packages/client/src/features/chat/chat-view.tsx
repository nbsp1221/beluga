import { Bubble, BubbleContent } from '@workspace/ui/components/bubble';
import { Message, MessageContent } from '@workspace/ui/components/message';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@workspace/ui/components/message-scroller';
import { Toaster } from '@workspace/ui/components/toast';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ConversationClient, Session } from '../conversation/contract.js';
import { getEmptySnapshot, subscribeToEmptyStore } from '../../state/store.js';
import { AssistantResponse } from './assistant-response.js';
import { MessageActions } from './message-actions.js';

export function ChatView({
  session,
  active = true,
  activity,
}: {
  session: Session;
  active?: boolean;
  activity?: ConversationClient['activity'];
}) {
  const latestMessage = session.messages.at(-1);
  const [today, setToday] = useState(() => new Date());
  const { id, completedSubmissionId } = session;
  const snapshot = useSyncExternalStore(
    activity?.subscribe ?? subscribeToEmptyStore,
    activity?.getSnapshot ?? getEmptySnapshot,
  );
  const unreadCompletion = snapshot?.[id]?.unreadCompletion;

  useEffect(() => {
    if (!active || !unreadCompletion || unreadCompletion !== completedSubmissionId || !activity) {
      return;
    }

    let frame: number | undefined;
    let requested = false;

    const visible = () => document.visibilityState === 'visible' && document.hasFocus();

    const schedule = () => {
      if (requested || frame !== undefined || !visible()) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        if (visible()) {
          requested = true;
          void activity.acknowledge(id, unreadCompletion).catch(() => {
            requested = false;
          });
        }
      });
    };

    schedule();
    window.addEventListener('focus', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener('focus', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [active, id, completedSubmissionId, unreadCompletion, activity]);

  useEffect(() => {
    let timer: number | undefined;

    function schedule(now: Date) {
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      timer = window.setTimeout(refresh, midnight.getTime() - now.getTime());
    }

    function refresh() {
      window.clearTimeout(timer);
      const now = new Date();
      setToday((previous) => (previous.toDateString() === now.toDateString() ? previous : now));
      schedule(now);
    }

    schedule(new Date());
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return (
    <MessageScrollerProvider key={session.id} defaultScrollPosition="end" autoScroll>
      <Toaster limit={1}>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent
              aria-label="Messages"
              aria-live="polite"
              className="mx-auto w-full max-w-3xl px-4 py-6"
            >
              {session.messages.map((message) => {
                return (
                  <MessageScrollerItem key={message.id} messageId={message.id}>
                    <Message align={message.role === 'user' ? 'end' : 'start'}>
                      <MessageContent className="gap-0 md:gap-1.5">
                        {message.role === 'user' ? (
                          <>
                            <Bubble variant="muted" align="end">
                              <BubbleContent>
                                <span className="sr-only">You: </span>
                                <p className="text-sm leading-6 break-words whitespace-pre-wrap">
                                  {message.text}
                                </p>
                              </BubbleContent>
                            </Bubble>
                            <MessageActions
                              role="user"
                              text={message.text}
                              timestamp={message.sentAt}
                              today={today}
                            />
                          </>
                        ) : (
                          <AssistantResponse
                            parts={message.parts}
                            activity={message.activity}
                            active={active}
                            completedAt={message.completedAt}
                            today={today}
                            latest={message === latestMessage}
                          />
                        )}
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              })}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </Toaster>
    </MessageScrollerProvider>
  );
}
