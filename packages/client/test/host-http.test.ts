import { expect, test } from 'vitest';
import { createHostRequest } from '../src/transport/host-http.js';

test('preserves HTTP status when a gateway returns a non-JSON error', async () => {
  const request = createHostRequest(new AbortController().signal, () =>
    Promise.resolve(new Response('Bad Gateway', { status: 502 })),
  );

  await expect(request('/api/example')).rejects.toMatchObject({
    status: 502,
    message: 'Host request failed.',
  });
});

test('preserves the Host error message for JSON errors', async () => {
  const request = createHostRequest(new AbortController().signal, () =>
    Promise.resolve(Response.json({ error: 'Invalid selection' }, { status: 400 })),
  );

  await expect(request('/api/example')).rejects.toMatchObject({
    status: 400,
    message: 'Invalid selection',
  });
});

test('accepts a successful response without a body', async () => {
  const request = createHostRequest(new AbortController().signal, () =>
    Promise.resolve(new Response(null, { status: 204 })),
  );

  await expect(request('/api/example')).resolves.toBeUndefined();
});
