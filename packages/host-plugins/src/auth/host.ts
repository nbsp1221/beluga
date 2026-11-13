import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Plugin } from '@workspace/runtime';
import { AUTH_PATH } from '@workspace/protocol/host';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { parse } from 'hono/utils/cookie';
import { type AccessCodeVerifier, verifyAccessCode } from './access-code.js';
import { acceptsSiteRequest } from './services.js';

export { issueAccessCode, readAccessCodeVerifier } from './access-code.js';
export { createDesktopAuth, desktopSessionCookie } from './desktop.js';

const COOKIE = 'beluga_session';
const sessionLifetimeSeconds = 24 * 60 * 60;
const loginWindowMs = 60_000;
const maxLoginAttempts = 10;

export interface AccessCodeOptions {
  origin: string;
  databasePath: string;
  loadVerifier(): Promise<AccessCodeVerifier>;
}

export function createAccessCodeAuth(options: AccessCodeOptions): Plugin {
  const origin = new URL(options.origin);
  const secure = origin.protocol === 'https:';
  if (
    options.origin !== origin.origin ||
    (!secure &&
      (origin.protocol !== 'http:' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))
  ) {
    throw new Error('Use an HTTPS origin or a local HTTP origin for Beluga.');
  }

  return {
    id: 'auth-access-code',
    provides: ['auth'],
    setup(context) {
      const db = new DatabaseSync(options.databasePath);
      context.onDispose(() => db.close());
      db.exec(
        'CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, revision TEXT NOT NULL) STRICT',
      );
      const activeSession = db.prepare(
        'SELECT 1 FROM auth_sessions WHERE token_hash = ? AND revision = ? AND expires > ?',
      );
      const renewSession = db.prepare(
        'UPDATE auth_sessions SET expires = ? WHERE token_hash = ? AND revision = ? AND expires > ?',
      );
      const createSession = db.prepare(
        'INSERT INTO auth_sessions (token_hash, expires, revision) VALUES (?, ?, ?)',
      );
      const revokeSession = db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?');
      const pruneSessions = db.prepare(
        'DELETE FROM auth_sessions WHERE expires <= ? OR revision <> ?',
      );

      const tokenHash = (id: string) =>
        createHash('sha256').update(origin.origin).update('\0').update(id).digest('hex');

      let loginAttempts = 0;
      let loginWindowEndsAt = 0;

      const credential = () => options.loadVerifier().catch(() => undefined);

      const cookie = {
        httpOnly: true,
        secure,
        sameSite: 'Strict',
        path: '/',
      } as const;

      const cookieId = (request: Request) =>
        parse(request.headers.get('cookie') ?? '', COOKIE)[COOKIE];

      const fromSite = (request: Request) => request.headers.get('origin') === origin.origin;

      const sessionIdentity = async (request: Request) => {
        if (!acceptsSiteRequest(request, origin.origin)) {
          return undefined;
        }
        const id = cookieId(request);
        const verifier = id ? await credential() : undefined;
        return id && verifier ? { id, hash: tokenHash(id), revision: verifier.digest } : undefined;
      };

      const authenticate = async (request: Request) => {
        const session = await sessionIdentity(request);
        return Boolean(session && activeSession.get(session.hash, session.revision, Date.now()));
      };

      const app = new Hono().basePath(AUTH_PATH);
      app.use('*', async (c, next) => {
        c.header('Cache-Control', 'no-store');
        await next();
      });

      app.get('/session', async (c) => c.json({ authenticated: await authenticate(c.req.raw) }));

      app.post('/visit', async (c) => {
        const session = await sessionIdentity(c.req.raw);
        const now = Date.now();
        if (
          !session ||
          !renewSession.run(
            now + sessionLifetimeSeconds * 1000,
            session.hash,
            session.revision,
            now,
          ).changes
        ) {
          return c.json({ error: 'Unauthorized' }, 401);
        }
        setCookie(c, COOKIE, session.id, { ...cookie, maxAge: sessionLifetimeSeconds });
        return c.body(null, 204);
      });

      app.post('/login', bodyLimit({ maxSize: 2048 }), async (c) => {
        if (!fromSite(c.req.raw)) {
          return c.json({ error: 'Forbidden' }, 403);
        }

        const verifier = await credential();
        if (!verifier) {
          return c.json({ error: 'Beluga access is unavailable.' }, 503);
        }

        const now = Date.now();
        if (now >= loginWindowEndsAt) {
          loginAttempts = 0;
          loginWindowEndsAt = now + loginWindowMs;
        }
        if (loginAttempts >= maxLoginAttempts) {
          return c.json({ error: 'Try again in a minute.' }, 429);
        }

        const body: unknown = await c.req.json().catch(() => null);
        const code = body && typeof body === 'object' && 'code' in body ? body.code : null;
        loginAttempts++;
        if (
          typeof code !== 'string' ||
          !(await verifyAccessCode(code, verifier)) ||
          (await credential())?.digest !== verifier.digest
        ) {
          return c.json({ error: 'The access code is incorrect.' }, 401);
        }

        loginAttempts = 0;
        const issuedAt = Date.now();
        pruneSessions.run(issuedAt, verifier.digest);
        const id = crypto.randomUUID();
        createSession.run(tokenHash(id), issuedAt + sessionLifetimeSeconds * 1000, verifier.digest);

        const previous = getCookie(c, COOKIE);
        if (previous) {
          revokeSession.run(tokenHash(previous));
        }
        setCookie(c, COOKIE, id, { ...cookie, maxAge: sessionLifetimeSeconds });
        return c.body(null, 204);
      });

      app.post('/logout', (c) => {
        if (!fromSite(c.req.raw)) {
          return c.json({ error: 'Forbidden' }, 403);
        }
        const id = getCookie(c, COOKIE);
        if (id) {
          revokeSession.run(tokenHash(id));
        }
        deleteCookie(c, COOKIE, cookie);
        return c.body(null, 204);
      });

      context.provide('auth', { authenticate, http: { fetch: app.fetch } });
    },
  };
}
