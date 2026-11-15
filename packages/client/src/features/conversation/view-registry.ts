import type { ConversationView, ConversationViews } from './contract.js';

export function createConversationViews(): ConversationViews {
  let snapshot: readonly ConversationView[] = [];
  const listeners = new Set<() => void>();

  const publish = () => listeners.forEach((listener) => listener());

  return {
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    register(view: ConversationView) {
      if (snapshot.some((item) => item.id === view.id)) {
        throw new Error(`Duplicate conversation view: ${view.id}`);
      }
      snapshot = [...snapshot, view];
      publish();
      return () => {
        snapshot = snapshot.filter((item) => item !== view);
        publish();
      };
    },
  };
}

export function resolveConversationView(
  views: readonly ConversationView[],
  requested: string | null,
) {
  return (
    views.find((view) => view.id === requested) ??
    views.find((view) => view.id === 'chat') ??
    views.at(0)
  );
}
