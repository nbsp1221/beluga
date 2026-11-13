import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageMarkdown } from '@workspace/ui/components/message-markdown';
import { ThemeProvider } from '@workspace/ui/components/theme-provider';
import { TooltipProvider } from '@workspace/ui/components/tooltip';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import { App } from './App.tsx';
import { createProduct } from './product.ts';

test('keeps an unsent draft when switching between Chat and Trajectory', async ({
  onTestFinished,
}) => {
  const user = userEvent.setup();
  const product = await createProduct();
  onTestFinished(() => product.dispose());

  render(
    <ThemeProvider>
      <TooltipProvider>
        <MemoryRouter initialEntries={['/chat/sample']}>
          <App views={product.get('views')} />
        </MemoryRouter>
      </TooltipProvider>
    </ThemeProvider>,
  );

  const chat = screen.getByRole('tab', { name: 'Chat' });
  expect(chat).toHaveAttribute('aria-selected', 'true');

  const composer = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(composer, { target: { value: 'Check the project layout' } });
  expect(composer).toHaveValue('Check the project layout');

  await user.click(screen.getByRole('tab', { name: 'Trajectory' }));
  expect(screen.getByRole('tab', { name: 'Trajectory' })).toHaveAttribute('aria-selected', 'true');

  await user.click(chat);
  expect(chat).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Check the project layout');
});

test('updates highlighted code when a streamed fence grows or is replaced', async () => {
  const fence = (code: string) => ['```js', code, '```'].join('\n');

  const { container, rerender } = render(
    <MessageMarkdown text={fence('/* open\ncontinued')} streaming />,
  );

  const code = () => container.querySelector('[data-slot="code-block-code"]');

  const highlighted = (text: string) =>
    Array.from(code()?.querySelectorAll('[style*="--shiki-"]') ?? []).find(
      (token) => token.textContent.trim() === text,
    );

  await waitFor(() => expect(highlighted('continued')).toBeInTheDocument());
  expect(code()).toHaveTextContent('continued');

  rerender(<MessageMarkdown text={fence('/* open\ncontinued\n*/\nconst answer = 42')} streaming />);
  await waitFor(() => expect(highlighted('const')).toBeInTheDocument());
  expect(code()).toHaveTextContent('const answer = 42');

  rerender(<MessageMarkdown text={fence('const replacement = 7')} streaming={false} />);
  await waitFor(() => expect(highlighted('replacement')).toBeInTheDocument());
  expect(code()).toHaveTextContent('const replacement = 7');
  expect(code()).not.toHaveTextContent('continued');
});
