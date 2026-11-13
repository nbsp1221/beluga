import type { Plugin } from '@workspace/runtime';
import { createElement, useEffect } from 'react';
import type { Session } from '../conversation/contract.js';
import { chatMarkdown } from './chat-markdown.js';
import { createClientModule } from './module-client.js';

const chatView = createClientModule(() => import('./chat-view.js'));

function hasAnswerText(session: Session) {
  return session.messages.some(
    (message) => message.role === 'assistant' && message.parts.some(({ type }) => type === 'text'),
  );
}

function prepareMarkdown() {
  // ChatMarkdown handles errors from the shared request when it renders.
  void chatMarkdown.prepare().catch(() => undefined);
}

function prepareChat(session: Session) {
  if (!session.messages.length) {
    return;
  }

  void chatView.prepare().catch(() => undefined);
  if (hasAnswerText(session)) {
    prepareMarkdown();
  }
}

function ChatPane({ session, active }: { session: Session; active?: boolean }) {
  const view = chatView.useModule();
  const hasAnswer = active && hasAnswerText(session);

  useEffect(() => {
    if (hasAnswer) {
      prepareMarkdown();
    }
  }, [hasAnswer]);

  return view ? createElement(view.ChatView, { session, active }) : null;
}

export const chatClient: Plugin = {
  id: 'chat',
  requires: ['conversationViews'],
  setup(context) {
    context.onDispose(
      context.get('conversationViews').register({
        id: 'chat',
        label: 'Chat',
        component: ChatPane,
        prepare: prepareChat,
        composer: true,
      }),
    );
  },
};
