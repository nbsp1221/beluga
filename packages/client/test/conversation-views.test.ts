import { expect, test } from 'vitest';
import {
  createConversationViews,
  resolveConversationView,
} from '../src/features/conversation/view-registry.js';

test('conversation views fall back to Chat when a feature unregisters', () => {
  const views = createConversationViews();

  const component = () => null;

  views.register({ id: 'chat', label: 'Chat', component, composer: true });
  const remove = views.register({
    id: 'trajectory',
    label: 'Trajectory',
    component,
    composer: false,
  });
  expect(resolveConversationView(views.getSnapshot(), 'trajectory')?.composer).toBe(false);
  expect(() =>
    views.register({
      id: 'trajectory',
      label: 'Duplicate',
      component,
      composer: true,
    }),
  ).toThrow(/Duplicate/);
  remove();
  expect(resolveConversationView(views.getSnapshot(), 'trajectory')?.id).toBe('chat');
  expect(resolveConversationView(views.getSnapshot(), 'unknown')?.id).toBe('chat');
});
