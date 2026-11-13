import { createElement } from 'react';
import { createClientModule } from './module-client.js';

export const chatMarkdown = createClientModule(
  () => import('@workspace/ui/components/message-markdown'),
);

export function ChatMarkdown(props: { text: string; streaming: boolean }) {
  const module = chatMarkdown.useModule();

  return module ? createElement(module.MessageMarkdown, props) : null;
}
