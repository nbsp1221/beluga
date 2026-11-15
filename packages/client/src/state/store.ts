export function createStore<T>(snapshot: T) {
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(this: void, next: T) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
}

export interface ReadStore<T> {
  getSnapshot(this: void): T;
  subscribe(this: void, listener: () => void): () => void;
}

export function subscribeToEmptyStore() {
  return () => undefined;
}

export function getEmptySnapshot() {
  return undefined;
}
