import type { TrajectoryPage } from '@workspace/protocol/host';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@workspace/ui/components/theme-provider';
import { TooltipProvider } from '@workspace/ui/components/tooltip';
import { MemoryRouter } from 'react-router';
import { type TestContext, expect, test } from 'vitest';
import { App } from './App.tsx';
import { createProduct } from './product.ts';

async function renderTrajectory({ onTestFinished }: TestContext) {
  const user = userEvent.setup();
  const turns: TrajectoryPage['requests'] = Array.from({ length: 60 }, (_, index) => {
    const turn = index + 1;
    return {
      turn,
      precedingModelRequests: index,
      request: {
        id: `turn-${turn}`,
        status: 'completed',
        records: [
          {
            id: `input-${turn}`,
            kind: 'user',
            text: turn === 1 ? 'Original question' : `Question ${turn}`,
          },
          { id: `output-${turn}`, kind: 'assistant', text: `Answer ${turn}`, status: 'completed' },
          ...(turn === 11
            ? [
                {
                  id: 'read-11',
                  kind: 'tool' as const,
                  name: 'read',
                  status: 'completed' as const,
                  modelRequestId: 'output-11',
                  input: { path: 'README.md' },
                },
              ]
            : []),
        ],
      },
    };
  });

  function respond(input: RequestInfo | URL) {
    const url = new URL(input instanceof Request ? input.url : input, 'http://localhost');
    if (url.pathname === '/api/conversations') {
      return Response.json({
        workspaces: [{ id: 'workspace', name: 'Workspace', path: '/workspace' }],
        sessions: [
          {
            id: 'history',
            title: 'Session',
            workspaceId: 'workspace',
            agentPresetId: 'preset',
            agentPresetName: 'Preset',
            agentPresetVersion: 1,
            agentPresetCapabilities: [],
            runSettings: { model: 'fixture/model', effort: 'default' },
            accessMode: 'read-only',
          },
        ],
        models: [],
        defaultModel: null,
      });
    }
    if (url.pathname === '/api/agent-presets') {
      return Response.json({ presets: [], capabilities: [], defaultPresetId: null });
    }
    if (url.pathname === '/api/conversations/history/trajectory') {
      return url.searchParams.get('q')
        ? Response.json({ requests: turns.slice(0, 1), before: null })
        : Response.json({ requests: turns.slice(-50), before: 11 });
    }
    return new Response(null, { status: 404 });
  }

  const product = await createProduct(true, {
    fetchHost: (input) => Promise.resolve(respond(input)),
  });
  onTestFinished(() => product.dispose());

  render(
    <ThemeProvider>
      <TooltipProvider>
        <MemoryRouter initialEntries={['/chat/history']}>
          <App views={product.get('views')} />
        </MemoryRouter>
      </TooltipProvider>
    </ThemeProvider>,
  );

  await user.click(screen.getByRole('tab', { name: 'Trajectory' }));
  // The first visit loads the Trajectory module before requesting the latest page.
  await screen.findByRole('button', { name: 'Turn 11' }, { timeout: 5_000 });
  return user;
}

test('expands and collapses trajectory rows from the keyboard without losing focus', async (context) => {
  const user = await renderTrajectory(context);
  const assistantRow = { name: 'Assistant: Answer 11' };
  const toolRow = { name: /^Tool read:/ };
  const turnFold = screen.getByRole('button', { name: 'Turn 11 records' });
  turnFold.focus();
  await user.keyboard('{Enter}');
  expect(turnFold).toHaveAttribute('aria-expanded', 'false');
  expect(turnFold).toHaveFocus();
  expect(screen.queryByRole('row', assistantRow)).not.toBeInTheDocument();
  expect(screen.queryByRole('complementary', { name: 'Event details' })).not.toBeInTheDocument();
  await user.keyboard(' ');
  expect(turnFold).toHaveAttribute('aria-expanded', 'true');
  const toolFold = within(screen.getByRole('row', assistantRow)).getByRole('button', {
    name: 'Tool calls',
  });
  toolFold.focus();
  await user.keyboard('{Enter}');
  expect(toolFold).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('row', toolRow)).not.toBeInTheDocument();
  await user.keyboard(' ');
  expect(toolFold).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('row', toolRow)).toBeVisible();
}, 10_000);

test('reveals the related response in an older turn without clearing the search', async (context) => {
  const user = await renderTrajectory(context);
  const search = screen.getByRole('searchbox', { name: 'Search trajectory' });
  fireEvent.change(search, { target: { value: 'original question' } });
  await user.click(await screen.findByRole('button', { name: 'Turn 1' }));
  const responseRow = { name: 'Assistant: Answer 1' };
  expect(screen.queryByRole('row', responseRow)).not.toBeInTheDocument();
  const inspector = await screen.findByRole('complementary', { name: 'Event details' });
  const openAnswer = within(inspector).getByRole('button', { name: 'assistant' });
  openAnswer.focus();
  await user.keyboard('{Enter}');

  expect(await within(inspector).findByText('Answer 1')).toBeVisible();
  const row = screen.getByRole('row', responseRow);
  expect(row).toBeVisible();
  expect(search).toHaveValue('original question');

  row.focus();
  await user.keyboard('{Enter}');
  expect(row).toBeVisible();
  expect(row).toHaveFocus();

  await user.click(within(inspector).getByRole('button', { name: 'Close details' }));
  expect(screen.queryByRole('row', responseRow)).not.toBeInTheDocument();
  expect(search).toHaveValue('original question');
}, 10_000);
