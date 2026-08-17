import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type RunningAuthServer, startAuthServer } from "../src/auth-server.js";

interface ResponseRecord {
  body: string;
  headers: Headers;
  status: number;
}

const resources: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map(async (dispose) => await dispose()));
});

async function listen(server: Server): Promise<URL> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected TCP address");
  resources.push(
    async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  );
  return new URL(`http://127.0.0.1:${String(address.port)}`);
}

async function request(
  origin: URL,
  path: string,
  options: {
    body?: string;
    cookie?: string;
    method?: string;
    originHeader?: string;
  } = {},
): Promise<ResponseRecord> {
  return await new Promise<ResponseRecord>((resolve, reject) => {
    const request = httpRequest(
      new URL(path, origin),
      {
        headers: {
          accept: path.startsWith("/api/") ? "application/json" : "text/html",
          host: "dsh.example.com",
          origin: options.originHeader ?? "https://dsh.example.com",
          ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
          ...(options.body === undefined
            ? {}
            : {
                "content-length": Buffer.byteLength(options.body),
                "content-type": "application/x-www-form-urlencoded",
              }),
        },
        method: options.method ?? "GET",
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: new Headers(
              Object.entries(response.headers).flatMap(([name, value]) =>
                value === undefined
                  ? []
                  : Array.isArray(value)
                    ? value.map((item) => [name, item])
                    : [[name, String(value)]],
              ),
            ),
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    request.once("error", reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

async function fixture(): Promise<{
  auth: RunningAuthServer;
  origin: URL;
  stateDirectory: string;
}> {
  const upstream = createServer((incoming, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        host: incoming.headers.host,
        origin: incoming.headers.origin,
        path: incoming.url,
      }),
    );
  });
  const upstreamOrigin = await listen(upstream);
  const stateDirectory = await mkdtemp(join(tmpdir(), "dotdsh-auth-server-"));
  resources.push(async () => await rm(stateDirectory, { force: true, recursive: true }));

  const auth = await startAuthServer({
    host: "127.0.0.1",
    loginLockSeconds: 60,
    maxLoginAttempts: 3,
    port: 0,
    publicOrigin: new URL("https://dsh.example.com"),
    sessionTtlSeconds: 3600,
    stateDirectory,
    upstreamOrigin,
  });
  resources.push(async () => await auth.close());
  return { auth, origin: auth.origin, stateDirectory };
}

describe("authentication server", () => {
  it("gates setup, API access, and authenticated proxying", async () => {
    const { origin, stateDirectory } = await fixture();

    const setupPage = await request(origin, "/");
    expect(setupPage.status).toBe(200);
    expect(setupPage.body).toContain("Set owner password");
    const formToken = setupPage.body.match(/name="formToken" value="([^"]+)"/)?.[1];
    if (formToken === undefined) throw new Error("expected setup form token");

    const blockedApi = await request(origin, "/api/settings.describe");
    expect(blockedApi.status).toBe(503);

    const setup = await request(origin, "/auth/setup", {
      body: new URLSearchParams({
        confirmPassword: "correct horse battery staple",
        formToken,
        password: "correct horse battery staple",
      }).toString(),
      method: "POST",
      originHeader: "null",
    });
    expect(setup.status).toBe(303);
    const cookie = setup.headers.get("set-cookie");
    expect(cookie).toContain("dsh_auth_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    if (cookie === null) throw new Error("expected session cookie");
    const cookieValue = cookie.split(";", 1)[0];
    if (cookieValue === undefined) throw new Error("expected session cookie value");
    expect(await readFile(join(stateDirectory, "state.json"), "utf8")).not.toContain("correct horse battery staple");

    const unauthenticated = await request(origin, "/api/settings.describe");
    expect(unauthenticated.status).toBe(401);

    const authenticated = await request(origin, "/api/settings.describe", {
      cookie: cookieValue,
    });
    expect(authenticated.status).toBe(200);
    expect(JSON.parse(authenticated.body)).toMatchObject({
      host: expect.stringMatching(/^127\.0\.0\.1:/),
      origin: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/),
      path: "/api/settings.describe",
    });
  });

  it("rejects a foreign browser origin", async () => {
    const { origin } = await fixture();

    const response = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        new URL("/auth/setup", origin),
        {
          headers: {
            host: "dsh.example.com",
            origin: "https://attacker.invalid",
          },
          method: "POST",
        },
        (incoming) => resolve(incoming.statusCode ?? 0),
      );
      request.once("error", reject);
      request.end();
    });

    expect(response).toBe(403);
  });
});
