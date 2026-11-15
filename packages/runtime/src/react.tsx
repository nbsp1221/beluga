import { type ComponentType, createElement, useSyncExternalStore } from 'react';

export function createViews() {
  const entries = new Map<string, { component: ComponentType }>();
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach((listener) => listener());

  return {
    get(name: string) {
      return entries.get(name)?.component;
    },
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    register(name: string, component: ComponentType) {
      if (entries.has(name)) {
        throw new Error(`View "${name}" is already registered`);
      }
      const entry = { component };
      entries.set(name, entry);
      notify();

      return () => {
        if (entries.get(name) !== entry) {
          return;
        }
        entries.delete(name);
        notify();
      };
    },
  };
}

export type ViewRegistry = ReturnType<typeof createViews>;

export function Slot({ views, name }: { views: ViewRegistry; name: string }) {
  const component = useSyncExternalStore(views.subscribe, () => views.get(name));
  return component ? createElement(component) : null;
}
