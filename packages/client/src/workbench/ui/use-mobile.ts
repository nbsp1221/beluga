import { useSyncExternalStore } from 'react';

const query = '(width < 768px)';

const subscribe = (listener: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};

// Use viewport width, not the space remaining after the desktop rail.
export function useMobile() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const subscribeViewport = (listener: () => void) => {
  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', listener);
  return () => viewport?.removeEventListener('resize', listener);
};

// Some browsers resize only the visual viewport when the keyboard opens.
// Do not relayout the app around a magnified viewport during pinch zoom.
export function useMobileViewportHeight(mobile: boolean) {
  return useSyncExternalStore(
    subscribeViewport,
    () => {
      const viewport = window.visualViewport;
      return mobile && viewport?.scale === 1 ? viewport.height : undefined;
    },
    () => undefined,
  );
}
