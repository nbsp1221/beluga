import type { Runtime } from '@workspace/runtime';
import { Login, visitSite } from '@workspace/client/auth';
import { ThemeProvider } from '@workspace/ui/components/theme-provider';
import { TooltipProvider } from '@workspace/ui/components/tooltip';
import { StrictMode, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router';
import { App } from './App.tsx';
import './index.css';

type HotDisposal = { dispose(callback: () => Promise<void>): void };

async function start() {
  const connected =
    document.querySelector('meta[name="beluga-mode"][content="connected"]') !== null;
  const login = connected && window.location.pathname === '/login';
  if (connected && !login && !(await visitSite())) {
    return;
  }
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('The Beluga root element is missing.');
  }
  const root = createRoot(container);

  const render = (product?: Runtime, desktop?: { id: string; path: string }) => {
    const content = product ? <App views={product.get('views')} /> : <Login />;

    root.render(
      <StrictMode>
        <ThemeProvider>
          <TooltipProvider delay={500}>
            {desktop ? (
              <MemoryRouter key={desktop.id} initialEntries={[desktop.path]}>
                {desktop.id === 'local' && trackLocalRoute && (
                  <DesktopRoute track={trackLocalRoute} />
                )}
                {content}
              </MemoryRouter>
            ) : (
              <BrowserRouter>{content}</BrowserRouter>
            )}
          </TooltipProvider>
        </ThemeProvider>
      </StrictMode>,
    );
  };

  let trackLocalRoute: ((path: string) => void) | undefined;
  const desktop = document.querySelector('meta[name="beluga-desktop"]');
  const product = desktop
    ? await (
        await import('./desktop-product.tsx')
      ).createDesktopProduct(({ runtime, remote, path }) =>
        render(runtime, { id: remote?.id ?? 'local', path }),
      )
    : login
      ? undefined
      : await (await import('./product.ts')).createProduct(connected);

  if (product && 'initial' in product) {
    trackLocalRoute = product.trackLocalRoute;
    render(product.initial.runtime, { id: 'local', path: product.initial.path });
  } else {
    render(product);
  }

  // Vite awaits disposal before loading the replacement module.
  const hot: HotDisposal | undefined = import.meta.hot;
  hot?.dispose(async () => {
    root.unmount();
    await product?.dispose();
  });
}

function DesktopRoute({ track }: { track: (path: string) => void }) {
  const { pathname, search, hash } = useLocation();
  useLayoutEffect(() => track(pathname + search + hash), [pathname, search, hash, track]);
  return null;
}

void start().catch((error: unknown) => {
  console.error(error);
  const container = document.getElementById('root');
  if (container) {
    container.textContent = 'Unable to start Beluga.';
  }
});
