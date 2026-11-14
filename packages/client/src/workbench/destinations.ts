import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';

export interface Destination {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  component: ComponentType;
  sidebar?: {
    component: ComponentType;
    description: string;
  };
  order: number;
}

export interface ContextPanel {
  id: string;
  label: string;
  description: string;
  component: ComponentType;
  unavailable?: boolean;
}

export interface SettingsSection {
  id: string;
  label: string;
  icon: LucideIcon;
  description?: string;
  order?: number;
  component: ComponentType;
}

export function createDestinations() {
  let snapshot: readonly Destination[] = [];
  let panels: readonly ContextPanel[] = [];
  let settings: readonly SettingsSection[] = [];
  const listeners = new Set<() => void>();

  const publish = () => listeners.forEach((listener) => listener());

  return {
    getSettings: () => settings,
    registerSetting(section: SettingsSection) {
      if (section.id === 'general' || settings.some(({ id }) => id === section.id)) {
        throw new Error(`Duplicate settings section: ${section.id}`);
      }
      settings = [...settings, section].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      publish();
      return () => {
        settings = settings.filter((item) => item !== section);
        publish();
      };
    },
    getPanels: () => panels,
    registerPanel(panel: ContextPanel) {
      if (panels.some((item) => item.id === panel.id)) {
        throw new Error(`Duplicate panel: ${panel.id}`);
      }
      panels = [...panels, panel];
      publish();
      return () => {
        panels = panels.filter((item) => item !== panel);
        publish();
      };
    },
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    register(destination: Destination) {
      if (snapshot.some((item) => item.id === destination.id || item.path === destination.path)) {
        throw new Error(`Duplicate destination: ${destination.id}`);
      }
      snapshot = [...snapshot, destination].sort((a, b) => a.order - b.order);
      publish();
      return () => {
        snapshot = snapshot.filter((item) => item !== destination);
        publish();
      };
    },
  };
}

export type Destinations = ReturnType<typeof createDestinations>;
