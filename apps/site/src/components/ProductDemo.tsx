import { createDemoConversation, createDemoData } from '@workspace/client/bootstrap/demo';
import { createClientProduct } from '@workspace/client/bootstrap/product';
import { Slot } from '@workspace/runtime/react';
import { ThemeProvider } from '@workspace/ui/components/theme-provider';
import { TooltipProvider } from '@workspace/ui/components/tooltip';
import { useEffect, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { exampleSession } from './example-conversation';

const data = createDemoData((workspaces) =>
  createDemoConversation(workspaces, [
    { ...exampleSession, workspaceId: workspaces.getSnapshot()[0]?.id ?? null },
  ]),
);

export function ProductDemo() {
  const [runtime, setRuntime] = useState<Awaited<ReturnType<typeof createClientProduct>>>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    const pending = createClientProduct({ connected: false, data, defaultSidebarOpen: true });
    void pending.then(
      (next) => {
        if (!disposed) {
          setRuntime(next);
        }
      },
      () => {
        if (!disposed) {
          setFailed(true);
        }
      },
    );
    return () => {
      disposed = true;
      void pending.then(
        (next) => next.dispose(),
        () => undefined,
      );
    };
  }, []);

  if (failed) {
    return <p className="p-4 text-muted-foreground">The example could not load.</p>;
  }

  // Astro observes the placeholder, so its bounds must cover the frame.
  if (!runtime) {
    return (
      <p role="status" className="min-h-dvh p-4 text-muted-foreground">
        Loading example…
      </p>
    );
  }

  return (
    <ThemeProvider>
      <TooltipProvider delay={500}>
        <MemoryRouter initialEntries={['/chat/' + exampleSession.id]}>
          <Slot name="main" views={runtime.get('views')} />
        </MemoryRouter>
      </TooltipProvider>
    </ThemeProvider>
  );
}
