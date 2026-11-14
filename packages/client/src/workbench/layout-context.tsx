import { createContext, use } from 'react';
import type { ContextPanel } from './destinations.js';

interface Layout {
  mobile: boolean;
  viewportHeight: number | undefined;
  collapsed: boolean;
  drawer: boolean;
  toggleSidebar(this: void): void;
  closeDrawer(this: void): void;
  panels: readonly ContextPanel[];
  activePanel: string | null;
  togglePanel(this: void, id: string): void;
}

export const LayoutContext = createContext<Layout>({
  mobile: false,
  viewportHeight: undefined,
  collapsed: false,
  drawer: false,
  toggleSidebar: () => {},
  closeDrawer: () => {},
  panels: [],
  activePanel: null,
  togglePanel: () => {},
});

export const useLayout = () => use(LayoutContext);
