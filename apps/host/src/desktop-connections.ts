import { createHash, randomUUID } from 'node:crypto';
import { AUTH_PATH, DESKTOP_CONNECTIONS_PATH, productRoutes } from '@workspace/protocol/host';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

const remoteCookie = 'beluga_session';
const lastAddress = 'beluga_remote_address';
const cookieOptions = {
  path: DESKTOP_CONNECTIONS_PATH,
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
} as const;
const tokenPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

const productRoutePattern = (path: string) =>
  new RegExp(
    `^${path
      .split('/')
      .map((segment) =>
        segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      )
      .join('/')}$`,
  );

const conversationItem = productRoutePattern(productRoutes.sendMessage.path);
const apiRoutes = Object.values(productRoutes).map(({ method, path }) => ({
  method,
  pattern: productRoutePattern(path),
}));

interface Connection {
  origin: string;
  token: string;
}

export function createDesktopConnections(
  localOrigin: string,
  authenticate: (request: Request) => boolean | Promise<boolean>,
) {
  const active = new Map<string, Connection>();
  const lifetime = new AbortController();
  const app = new Hono().basePath(DESKTOP_CONNECTIONS_PATH);
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    if (!(await authenticate(c.req.raw))) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    if (c.req.method !== 'GET' && c.req.header('Origin') !== localOrigin) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
  });

  app.get('/', (c) => c.json({ address: getCookie(c, lastAddress) ?? '' }));
  app.post('/', bodyLimit({ maxSize: 4096 }), async (c) => {
    const input: unknown = await c.req.json().catch(() => null);
    const { address, code } = (input ?? {}) as { address?: unknown; code?: unknown };
    const origin = typeof address === 'string' ? serverOrigin(address) : undefined;
    if (!origin || typeof code !== 'string') {
      return c.json({ error: 'Enter an HTTP or HTTPS server address without a path.' }, 400);
    }

    const cookieName = 'beluga_remote_' + createHash('sha256').update(origin).digest('hex');
    const previous = getCookie(c, cookieName);
    const saved = previous && tokenPattern.test(previous) ? previous : undefined;
    if (!code && !saved) {
      return c.json({ error: 'Enter this server’s access code.' }, 401);
    }

    const signal = AbortSignal.any([
      lifetime.signal,
      c.req.raw.signal,
      AbortSignal.timeout(10_000),
    ]);
    try {
      const response = await remoteFetch(
        origin,
        code ? undefined : saved,
        AUTH_PATH + (code ? '/login' : '/visit'),
        {
          method: 'POST',
          signal,
          ...(code ? { body: JSON.stringify({ code }) } : {}),
        },
      );
      await response.body?.cancel();
      if (response.status === 401) {
        if (!code) {
          deleteCookie(c, cookieName, cookieOptions);
        }
        return c.json(
          { error: code ? 'The access code is incorrect.' : 'Enter this server’s access code.' },
          401,
        );
      }
      if (response.status === 429) {
        return c.json({ error: 'Too many attempts. Try again in a minute.' }, 429);
      }
      const session = response.status === 204 ? readRemoteSession(response) : undefined;
      if (!session) {
        return c.json({ error: 'The server did not return a Beluga session.' }, 502);
      }
      signal.throwIfAborted();
      const id = randomUUID();
      active.set(id, { origin, token: session.token });
      setCookie(c, cookieName, session.token, { ...cookieOptions, maxAge: session.maxAge });
      setCookie(c, lastAddress, origin, { ...cookieOptions, maxAge: session.maxAge });
      return c.json({ address: origin, id }, 201);
    } catch {
      return c.json({ error: 'Could not reach the server at this address.' }, 502);
    }
  });

  app.delete('/:id', (c) => {
    active.delete(c.req.param('id'));
    return c.body(null, 204);
  });

  app.all('/:id/*', bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
    const id = c.req.param('id');
    const connection = id ? active.get(id) : undefined;
    if (!id || !connection) {
      return c.json({ error: 'Connection is no longer available.' }, 404);
    }
    const url = new URL(c.req.url);
    const path = url.pathname.slice(DESKTOP_CONNECTIONS_PATH.length + id.length + 1);
    if (
      /%2f|%5c/i.test(path) ||
      !apiRoutes.some(({ method, pattern }) => method === c.req.method && pattern.test(path))
    ) {
      return c.json({ error: 'Unknown Beluga API route.' }, 404);
    }

    try {
      const body = c.req.raw.body ? await c.req.text() : undefined;
      const response = await remoteFetch(connection.origin, connection.token, path + url.search, {
        method: c.req.method,
        body,
        headers: c.req.raw.headers,
        signal: AbortSignal.any([lifetime.signal, c.req.raw.signal]),
      });
      if (response.status === 401) {
        await response.body?.cancel();
        return c.json(
          { error: 'Remote session expired. Reconnect in Settings → Connections.' },
          401,
        );
      }
      const receipt =
        c.req.method === 'POST' && response.status === 202 && conversationItem.test(path);
      return await productResponse(response, receipt ? localOrigin + url.pathname : undefined);
    } catch {
      return c.json({ error: 'The remote Host is unavailable.' }, 502);
    }
  });

  return {
    handle(request: Request) {
      const { pathname } = new URL(request.url);
      if (
        pathname === DESKTOP_CONNECTIONS_PATH ||
        pathname.startsWith(DESKTOP_CONNECTIONS_PATH + '/')
      ) {
        return app.fetch(request);
      }
    },
    stop: () => lifetime.abort(),
  };
}

function serverOrigin(value: string) {
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    ) {
      return url.origin;
    }
  } catch {
    return undefined;
  }
}

function remoteFetch(origin: string, token: string | undefined, path: string, init: RequestInit) {
  const url = new URL(path, origin);
  if (url.origin !== origin || !url.pathname.startsWith('/api/')) {
    throw new Error('Invalid remote API URL.');
  }
  const headers = new Headers({ Origin: origin });
  if (token) {
    headers.set('Cookie', `${remoteCookie}=${token}`);
  }
  if (init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const validator = new Headers(init.headers).get('If-None-Match');
  if (validator) {
    headers.set('If-None-Match', validator);
  }
  return fetch(url, { ...init, headers, redirect: 'error' });
}

function readRemoteSession(response: Response) {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(remoteCookie + '='));
  const token = cookie?.slice(remoteCookie.length + 1).split(';')[0];
  const maxAge = Number(cookie?.match(/;\s*max-age=(\d+)(?:;|$)/i)?.[1]);
  if (token && tokenPattern.test(token) && Number.isSafeInteger(maxAge) && maxAge > 0) {
    return { token, maxAge };
  }
}

async function productResponse(upstream: Response, streamUrl?: string) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  for (const name of [
    'Stream-Next-Offset',
    'Stream-Up-To-Date',
    'Stream-Closed',
    'Stream-Cursor',
    'Flue-Error-Ref',
    'ETag',
  ]) {
    const value = upstream.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  const contentType = upstream.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
  if (upstream.body === null) {
    return new Response(null, { status: upstream.status, headers });
  }
  if (contentType !== 'application/json' && contentType !== 'text/event-stream') {
    await upstream.body.cancel();
    return Response.json(
      { error: 'The remote Host returned an unsupported response.' },
      {
        status: 502,
        headers,
      },
    );
  }
  if (streamUrl) {
    const receipt: unknown = await upstream.json();
    if (!receipt || typeof receipt !== 'object') {
      throw new Error('Invalid Flue admission.');
    }
    return Response.json({ ...receipt, streamUrl }, { status: upstream.status, headers });
  }
  headers.set('Content-Type', contentType);
  return new Response(upstream.body, { status: upstream.status, headers });
}
