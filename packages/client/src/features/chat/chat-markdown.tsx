import { createElement } from 'react';
import { createClientModule } from './module-client.js';

export const chatMarkdown = createClientModule(
  () => import('@workspace/ui/components/message-markdown'),
);

export function ChatMarkdown(props: { text: string; streaming: boolean }) {
  const { module, failed } = chatMarkdown.useModule();

  if (failed) {
    return <p className="text-sm leading-6 wrap-break-word whitespace-pre-wrap">{props.text}</p>;
  }
  return module ? createElement(module.MessageMarkdown, props) : null;
}
