import { createRuntime } from '@workspace/runtime';
import { expect, test } from 'vitest';
import { createDesktopAuth, desktopSessionCookie } from '../src/auth/desktop.js';

const origin = 'http://127.0.0.1:31201';

test('authenticates only the current desktop session and its own mutation origin', async () => {
  const token = 'fixture-desktop-token';
  const cookie = `${desktopSessionCookie}=${token}`;
  const runtime = await createRuntime([createDesktopAuth(origin, token)]);
  try {
    const auth = runtime.get('auth');

    const visit = (requestOrigin: string, requestCookie: string) =>
      new Request(`${origin}/api/auth/visit`, {
        method: 'POST',
        headers: { origin: requestOrigin, cookie: requestCookie },
      });

    expect(await auth.authenticate(new Request(origin))).toBe(false);
    expect(await auth.authenticate(visit(origin, `${desktopSessionCookie}=old-token`))).toBe(false);
    expect(await auth.authenticate(visit('http://127.0.0.1:31202', cookie))).toBe(false);
    expect(await auth.authenticate(visit(origin, cookie))).toBe(true);
    const response = await auth.http?.fetch(visit(origin, cookie));
    expect(response?.status).toBe(204);
    expect(response?.headers.has('set-cookie')).toBe(false);
  } finally {
    await runtime.dispose();
  }
});
