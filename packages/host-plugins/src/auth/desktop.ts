import { createHash, timingSafeEqual } from 'node:crypto';
import type { Plugin } from '@workspace/runtime';
import { AUTH_PATH } from '@workspace/protocol/host';
import { Hono } from 'hono';
import { parse } from 'hono/utils/cookie';
import { acceptsSiteRequest } from './services.js';

export const desktopSessionCookie = 'beluga_desktop_session';

export function createDesktopAuth(origin: string, token: string): Plugin {
  const digest = (value: string) => createHash('sha256').update(value).digest();

  const expected = digest(token);

  return {
    id: 'auth-desktop',
    provides: ['auth'],
    setup(context) {
      const authenticate = (request: Request) => {
        if (!acceptsSiteRequest(request, origin)) {
          return false;
        }
        const cookies = parse(request.headers.get('cookie') ?? '');
        return (
          Object.hasOwn(cookies, desktopSessionCookie) &&
          timingSafeEqual(expected, digest(cookies[desktopSessionCookie]))
        );
      };

      const app = new Hono().basePath(AUTH_PATH);
      app.use('*', async (c, next) => {
        c.header('Cache-Control', 'no-store');
        await next();
      });
      app.get('/session', (c) => c.json({ authenticated: authenticate(c.req.raw) }));
      app.post('/visit', (c) =>
        authenticate(c.req.raw) ? c.body(null, 204) : c.json({ error: 'Unauthorized' }, 401),
      );
      context.provide('auth', { authenticate, http: { fetch: app.fetch } });
    },
  };
}
