import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Connections } from './Connections.tsx';

test('returns to this computer while a remote connection attempt is pending', async () => {
  const user = userEvent.setup();
  let signal: AbortSignal | undefined;
  const connect = vi.fn((_address: string, _code: string, requestSignal: AbortSignal) => {
    signal = requestSignal;
    return new Promise<void>((resolve) => {
      requestSignal.addEventListener('abort', () => resolve(), { once: true });
    });
  });
  const selectLocal = vi.fn(() => Promise.resolve());
  render(
    <Connections
      remoteAddress="https://previous.example"
      connect={connect}
      selectLocal={selectLocal}
    />,
  );

  const connectButton = screen.getByRole('button', { name: 'Connect' });
  await user.click(connectButton);
  await waitFor(() => expect(connect).toHaveBeenCalledOnce());
  expect(connectButton).toBeDisabled();

  const openLocal = screen.getByRole('button', { name: 'Open' });
  expect(openLocal).toBeEnabled();
  await user.click(openLocal);

  expect(selectLocal).toHaveBeenCalledOnce();
  expect(signal?.aborted).toBe(true);
});
