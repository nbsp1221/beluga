import type { ViewRegistry } from '@workspace/runtime/react';
import type { Destinations } from './destinations.js';

declare module '@workspace/runtime' {
  interface Services {
    views: ViewRegistry;
    destinations: Destinations;
  }
}

export { useLayout } from './layout-context.js';
