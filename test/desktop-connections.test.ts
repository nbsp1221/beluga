import { expect, test, vi } from 'vitest';
import { createDesktopConnections } from '../apps/host/src/desktop-connections.js';

const desktop = 'http://127.0.0.1:32100';
const base = '/api/desktop/connections';
const sessionA = '00112233-4455-6677-8899-aabbccddeeff';
const sessionB = '11223344-5566-7788-99aa-bbccddeeff00';

test('binds sessions and product requests to their configured HTTP or HTTPS Host', async ({
  onTestFinished,
}) => {
  const service = createDesktopConnections(desktop, () => true);
  onTestFinished(() => {
    service.stop();
    vi.unstubAllGlobals();
  });
  const upstream = vi.fn((input: URL, init: RequestInit) => {
    const url = input;
    const token = url.protocol === 'http:' ? sessionA : sessionB;
    const headers = new Headers(init.headers);
    expect(headers.get('origin')).toBe(url.origin);
    expect(headers.get('authorization')).toBeNull();
    expect(init.redirect).toBe('error');
    const expectedCookie = url.pathname === '/api/auth/login' ? null : 'beluga_session=' + token;
    expect(headers.get('cookie')).toBe(expectedCookie);
    if (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/visit') {
      return new Response(null, {
        status: 204,
        headers: {
          'Set-Cookie': `beluga_session=${token}; Max-Age=86400; HttpOnly${url.protocol === 'https:' ? '; Secure' : ''}`,
        },
      });
    }
    if (url.pathname.endsWith('/usage')) {
      return new Response('<script>throw 1</script>', {
        headers: { 'Content-Type': 'text/html', 'Clear-Site-Data': '"cookies"' },
      });
    }
    if (init.method === 'POST') {
      return Response.json(
        { streamUrl: 'https://wrong.example/api/conversations/other', submissionId: 'submission' },
        {
          status: 202,
          headers: {
            'Location': 'https://wrong.example',
            'Set-Cookie': 'injected=value',
            'Stream-Next-Offset': '3',
          },
        },
      );
    }
    return Response.json({ origin: url.origin });
  });
  vi.stubGlobal('fetch', upstream);

  const request = async (path: string, method = 'GET', body?: object, cookie?: string) => {
    const response = await service.handle(
      new Request(desktop + base + path, {
        method,
        headers: {
          Origin: desktop,
          Authorization: 'local-only',
          Cookie: cookie ?? 'local-only=cookie',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      }),
    );
    if (!response) {
      throw new Error('Expected a desktop API response.');
    }
    return response;
  };

  const http = 'http://a.example:8917';
  const https = 'https://a.example:8917';
  const login = await request('', 'POST', { address: http, code: 'fixture' });
  expect(login.status).toBe(201);

  const first = await readConnectionId(login);
  const cookies = login.headers.getSetCookie();
  expect(cookies[0]).toContain('HttpOnly');
  expect(cookies[0]).toContain('Secure');
  expect(cookies[0]).toContain('Max-Age=86400');
  const reconnect = await request(
    '',
    'POST',
    { address: http, code: '' },
    cookies[0].split(';')[0],
  );
  expect(reconnect.status).toBe(201);
  const newLogin = await request(
    '',
    'POST',
    { address: http, code: 'fixture' },
    cookies[0].split(';')[0],
  );
  expect(newLogin.status).toBe(201);
  const crossOrigin = await request(
    '',
    'POST',
    { address: https, code: '' },
    cookies[0].split(';')[0],
  );
  expect(crossOrigin.status).toBe(401);
  const next = await request('', 'POST', { address: https, code: 'fixture' });
  const second = await readConnectionId(next);
  const conversation = '/api/conversations/shared-id';
  expect(await (await request('/' + first + conversation)).json()).toEqual({ origin: http });
  expect(await (await request('/' + second + conversation)).json()).toEqual({ origin: https });

  const receipt = await request('/' + first + conversation, 'POST', { body: 'Hello' });
  expect(receipt.headers.get('set-cookie')).toBeNull();
  expect(receipt.headers.get('location')).toBeNull();
  expect(receipt.headers.get('stream-next-offset')).toBe('3');
  expect(await receipt.json()).toMatchObject({
    streamUrl: desktop + base + '/' + first + conversation,
  });

  const unsupported = await request('/' + first + conversation + '/usage');
  expect(unsupported.status).toBe(502);
  expect(unsupported.headers.get('clear-site-data')).toBeNull();
  expect(unsupported.headers.get('x-content-type-options')).toBe('nosniff');
  expect((await request('/' + first + '/api/auth/session')).status).toBe(404);
  expect((await request('/' + first, 'DELETE')).status).toBe(204);
  expect((await request('/' + first + conversation)).status).toBe(404);
  expect(await (await request('/' + second + conversation)).json()).toEqual({ origin: https });
});

test('requires local desktop authentication and a same-origin mutation', async () => {
  const request = new Request(desktop + base, {
    method: 'POST',
    headers: { Origin: 'http://other.example' },
  });
  const anonymous = createDesktopConnections(desktop, () => false);
  expect((await anonymous.handle(request))?.status).toBe(401);
  const authenticated = createDesktopConnections(desktop, () => true);
  expect((await authenticated.handle(request))?.status).toBe(403);
});

async function readConnectionId(response: Response) {
  const value: unknown = await response.json();
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id;
  }
  throw new Error('Expected a desktop connection id.');
}
