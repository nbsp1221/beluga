import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Runtime, createRuntime } from '@workspace/runtime';
import { type TestContext, expect, test, vi } from 'vitest';
import { createAccessCodeVerifier } from '../src/auth/access-code.js';
import { createAccessCodeAuth } from '../src/auth/host.js';

const origin = 'https://beluga.example';
const accessCode = 'test-only-random-access-code';
const day = 24 * 60 * 60 * 1000;

function post(path: string, cookie = '', requestOrigin = origin, body?: unknown) {
  return new Request(origin + path, {
    method: 'POST',
    headers: { 'origin': requestOrigin, cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function authFixture({ onTestFinished }: TestContext) {
  let verifier = await createAccessCodeVerifier(accessCode);
  const root = await mkdtemp(join(tmpdir(), 'beluga-auth-'));
  const options = {
    origin,
    databasePath: join(root, 'auth.sqlite'),
    loadVerifier: () => Promise.resolve(verifier),
  };

  const boot = () => createRuntime([createAccessCodeAuth(options)]);

  let runtime: Runtime | undefined;
  onTestFinished(async () => {
    try {
      await runtime?.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  runtime = await boot();

  async function restart() {
    await runtime?.dispose();
    runtime = await boot();
    return runtime.get('auth');
  }

  const auth = runtime.get('auth');
  const { http } = auth;
  assert(http);

  const login = (code = accessCode) => http.fetch(post('/api/auth/login', '', origin, { code }));

  async function session() {
    const response = await login();
    expect(response.status).toBe(204);
    const header = response.headers.get('set-cookie');
    assert(header, 'Login must issue a cookie');
    const cookie = header.split(';')[0];
    return {
      header,
      cookie,
      read: new Request(origin + '/api/conversations', { headers: { cookie } }),
    };
  }

  async function rotate(code: string) {
    verifier = await createAccessCodeVerifier(code);
  }

  return { auth, http, login, session, rotate, restart };
}

test('issues a protected cookie after login and rejects writes from another origin', async (context) => {
  const { auth, login, session } = await authFixture(context);
  expect((await login('wrong')).status).toBe(401);

  const { header, cookie, read } = await session();
  for (const attribute of ['Max-Age=86400', 'HttpOnly', 'Secure', 'SameSite=Strict']) {
    expect(header).toContain(attribute);
  }
  expect(await auth.authenticate(read)).toBe(true);
  expect(await auth.authenticate(post('/api/conversations', cookie, 'https://other.example'))).toBe(
    false,
  );
});

test('renews a 24-hour session on a site visit and lets it expire after further reads', async (context) => {
  const start = Date.parse('2026-01-01T00:00:00Z');
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
  context.onTestFinished(() => {
    clock.mockRestore();
  });
  const { http, session, restart } = await authFixture(context);
  const { cookie, read } = await session();

  clock.mockReturnValue(start + day - 1000);
  const visit = await http.fetch(post('/api/auth/visit', cookie));
  expect(visit.status).toBe(204);
  expect(visit.headers.get('set-cookie')).toContain('Max-Age=86400');

  const auth = await restart();
  clock.mockReturnValue(start + 2 * day - 2000);
  expect(await auth.authenticate(read)).toBe(true);
  clock.mockReturnValue(start + 2 * day);
  expect(await auth.authenticate(read)).toBe(false);
});

test('persists sessions across restart and revokes them on logout or access-code rotation', async (context) => {
  const { session, restart, rotate } = await authFixture(context);
  const loggedOut = await session();
  const rotated = await session();
  const auth = await restart();
  expect(await auth.authenticate(loggedOut.read)).toBe(true);
  expect(await auth.authenticate(rotated.read)).toBe(true);
  const { http } = auth;
  assert(http);

  expect((await http.fetch(post('/api/auth/logout', loggedOut.cookie))).status).toBe(204);
  const afterLogout = await restart();
  expect(await afterLogout.authenticate(loggedOut.read)).toBe(false);
  expect(await afterLogout.authenticate(rotated.read)).toBe(true);

  const newCode = 'new-test-only-access-code';
  await rotate(newCode);
  expect(await afterLogout.authenticate(post('/api/auth/visit', rotated.cookie))).toBe(false);
  const afterRotation = await restart();
  expect(await afterRotation.authenticate(rotated.read)).toBe(false);
  assert(afterRotation.http);
  expect(
    (await afterRotation.http.fetch(post('/api/auth/login', '', origin, { code: accessCode })))
      .status,
  ).toBe(401);
  expect(
    (await afterRotation.http.fetch(post('/api/auth/login', '', origin, { code: newCode }))).status,
  ).toBe(204);
});
