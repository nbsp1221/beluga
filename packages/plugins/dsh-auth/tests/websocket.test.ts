import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type RunningAuthServer, startAuthServer } from "../src/auth-server.js";

const resources: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of resources.splice(0).reverse()) await dispose();
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
        server.closeAllConnections();
      }),
  );
  return new URL(`http://127.0.0.1:${String(address.port)}`);
}

async function startFixture(): Promise<RunningAuthServer> {
  const upstream = createServer();
  upstream.on("upgrade", (_request, socket) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
    socket.once("end", () => socket.destroy());
  });
  const upstreamOrigin = await listen(upstream);
  const stateDirectory = await mkdtemp(join(tmpdir(), "dotdsh-auth-websocket-"));
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
  return auth;
}

async function setup(origin: URL): Promise<string> {
  const formToken = await new Promise<string>((resolve, reject) => {
    const request = httpRequest(
      new URL("/", origin),
      {
        headers: {
          accept: "text/html",
          host: "dsh.example.com",
          origin: "https://dsh.example.com",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () => {
          const token = Buffer.concat(chunks)
            .toString("utf8")
            .match(/name="formToken" value="([^"]+)"/)?.[1];
          if (token === undefined) reject(new Error("expected setup form token"));
          else resolve(token);
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
  const body = new URLSearchParams({
    confirmPassword: "correct horse battery staple",
    formToken,
    password: "correct horse battery staple",
  }).toString();
  return await new Promise<string>((resolve, reject) => {
    const request = httpRequest(
      new URL("/auth/setup", origin),
      {
        headers: {
          "content-length": Buffer.byteLength(body),
          "content-type": "application/x-www-form-urlencoded",
          host: "dsh.example.com",
          origin: "https://dsh.example.com",
        },
        method: "POST",
      },
      (response) => {
        const cookie = response.headers["set-cookie"]?.[0]?.split(";", 1)[0];
        if (cookie === undefined) reject(new Error("expected session cookie"));
        else resolve(cookie);
        response.resume();
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

async function upgrade(origin: URL, cookie?: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = connect(Number(origin.port), origin.hostname);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("upgrade response timed out"));
    }, 2_000);
    let response = "";
    socket.once("error", reject);
    socket.on("data", (chunk: Buffer) => {
      response += chunk.toString("utf8");
      if (!response.includes("\r\n\r\n")) return;
      clearTimeout(timeout);
      socket.destroy();
      resolve(response.split("\r\n", 1)[0] ?? "");
    });
    socket.once("connect", () => {
      socket.write(
        [
          "GET /api/events.host HTTP/1.1",
          "Host: dsh.example.com",
          "Origin: https://dsh.example.com",
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==",
          "Sec-WebSocket-Version: 13",
          ...(cookie === undefined ? [] : [`Cookie: ${cookie}`]),
          "",
          "",
        ].join("\r\n"),
      );
    });
  });
}

describe("WebSocket authentication", () => {
  it("rejects setup and unauthenticated upgrades, then proxies an authenticated upgrade", async () => {
    const auth = await startFixture();

    expect(await upgrade(auth.origin)).toContain("503");
    const cookie = await setup(auth.origin);
    expect(await upgrade(auth.origin)).toContain("401");
    expect(await upgrade(auth.origin, cookie)).toContain("101 Switching Protocols");
  });
});
