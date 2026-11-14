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
import { useEffect, useState } from 'react';
import type { Session } from '../conversation/contract.js';
import { AssistantResponse } from './assistant-response.js';
import { MessageActions } from './message-actions.js';

export function ChatView({ session, active = true }: { session: Session; active?: boolean }) {
  const latestMessage = session.messages.at(-1);
  const [today, setToday] = useState(() => new Date());

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
