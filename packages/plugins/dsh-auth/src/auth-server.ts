import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import {
  clearSessionCookie,
  cookieValue,
  InvalidRequestError,
  isHtmlNavigation,
  isTrustedPublicAuthority,
  isTrustedPublicRequest,
  readForm,
  redirect,
  SESSION_COOKIE,
  safeNextPath,
  sendHtml,
  sendJson,
  sessionCookie,
} from "./http.js";
import { loginPage } from "./login-page.js";
import { hashPassword, validatePassword, verifyPassword } from "./password.js";
import { proxyHttp, proxyUpgrade } from "./proxy.js";
import { SessionStore } from "./sessions.js";
import { AlreadyInitializedError, AuthStateStore } from "./state.js";

export interface AuthServerOptions {
  host: "0.0.0.0" | "127.0.0.1";
  loginLockSeconds: number;
  maxLoginAttempts: number;
  port: number;
  publicOrigin: URL;
  sessionTtlSeconds: number;
  stateDirectory: string;
  upstreamOrigin: URL;
}

export interface RunningAuthServer {
  close(): Promise<void>;
  origin: URL;
}

interface LoginFailures {
  count: number;
  lockedUntil: number;
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.end(`HTTP/1.1 ${String(status)} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export async function startAuthServer(options: AuthServerOptions): Promise<RunningAuthServer> {
  if (options.upstreamOrigin.protocol !== "http:" || options.upstreamOrigin.hostname !== "127.0.0.1") {
    throw new Error("Authenticated proxy upstream must be an HTTP loopback address.");
  }

  const stateStore = new AuthStateStore(options.stateDirectory);
  let state = await stateStore.read();
  const sessions = new SessionStore(options.sessionTtlSeconds);
  const failures = new Map<string, LoginFailures>();
  const upgradedSockets = new Set<Duplex>();
  const formToken = randomBytes(32).toString("base64url");

  const hasValidFormToken = (form: URLSearchParams): boolean => {
    const candidate = form.get("formToken");
    if (candidate === null) return false;
    const expected = Buffer.from(formToken);
    const actual = Buffer.from(candidate);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  };

  const handleSetup = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (state.kind === "initialized") {
      sendJson(response, 409, { error: "Authentication is already initialized." });
      return;
    }
    const form = await readForm(request);
    if (!hasValidFormToken(form)) {
      sendJson(response, 403, { error: "Forbidden" });
      return;
    }
    const password = form.get("password") ?? "";
    const confirmation = form.get("confirmPassword") ?? "";
    const error = password !== confirmation ? "Passwords do not match." : validatePassword(password);
    if (error !== undefined) {
      sendHtml(response, 400, loginPage({ error, formToken, mode: "setup" }));
      return;
    }

    try {
      const passwordHash = await hashPassword(password);
      await stateStore.initialize(passwordHash);
      state = { kind: "initialized", passwordHash, revision: 1 };
    } catch (caught) {
      if (!(caught instanceof AlreadyInitializedError)) throw caught;
      state = await stateStore.read();
      sendJson(response, 409, { error: "Authentication was initialized concurrently." });
      return;
    }

    const token = sessions.create(state.revision);
    redirect(response, "/", sessionCookie(token, options.sessionTtlSeconds));
  };

  const handleLogin = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (state.kind === "uninitialized") {
      sendHtml(response, 409, loginPage({ formToken, mode: "setup" }));
      return;
    }
    const key = request.socket.remoteAddress ?? "unknown";
    const failure = failures.get(key);
    if (failure !== undefined && failure.lockedUntil > Date.now()) {
      sendHtml(response, 429, loginPage({ error: "Too many attempts. Try again later.", formToken, mode: "login" }));
      return;
    }

    const form = await readForm(request);
    if (!hasValidFormToken(form)) {
      sendJson(response, 403, { error: "Forbidden" });
      return;
    }
    const password = form.get("password") ?? "";
    if (!(await verifyPassword(password, state.passwordHash))) {
      const count = (failure?.count ?? 0) + 1;
      failures.set(key, {
        count,
        lockedUntil: count >= options.maxLoginAttempts ? Date.now() + options.loginLockSeconds * 1000 : 0,
      });
      sendHtml(
        response,
        401,
        loginPage({
          error: "The password is incorrect.",
          formToken,
          mode: "login",
          next: safeNextPath(form.get("next")),
        }),
      );
      return;
    }

    failures.delete(key);
    const token = sessions.create(state.revision);
    redirect(response, safeNextPath(form.get("next")), sessionCookie(token, options.sessionTtlSeconds));
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url ?? "/", options.publicOrigin);
    const opaqueAuthForm =
      request.method === "POST" &&
      ["/auth/login", "/auth/setup"].includes(path.pathname) &&
      request.headers.origin === "null" &&
      isTrustedPublicAuthority(request, options.publicOrigin);
    if (!isTrustedPublicRequest(request, options.publicOrigin) && !opaqueAuthForm) {
      sendJson(response, 403, { error: "Forbidden" });
      return;
    }
    if (request.method === "POST" && path.pathname === "/auth/setup") {
      await handleSetup(request, response);
      return;
    }
    if (request.method === "POST" && path.pathname === "/auth/login") {
      await handleLogin(request, response);
      return;
    }
    if (path.pathname === "/auth/logout") {
      const token = cookieValue(request, SESSION_COOKIE);
      if (token !== undefined) sessions.delete(token);
      redirect(response, "/auth/login", clearSessionCookie());
      return;
    }

    if (state.kind === "uninitialized") {
      if (isHtmlNavigation(request)) sendHtml(response, 200, loginPage({ formToken, mode: "setup" }));
      else sendJson(response, 503, { error: "Owner setup is required." });
      return;
    }

    const token = cookieValue(request, SESSION_COOKIE);
    if (token === undefined || !sessions.has(token, state.revision)) {
      if (isHtmlNavigation(request)) {
        sendHtml(
          response,
          200,
          loginPage({ formToken, mode: "login", next: safeNextPath(path.pathname + path.search) }),
        );
      } else sendJson(response, 401, { error: "Authentication required." });
      return;
    }
    proxyHttp(request, response, options.upstreamOrigin);
  };

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (error instanceof InvalidRequestError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      console.error("dotdsh auth request failed", error);
      if (!response.headersSent) sendJson(response, 500, { error: "Internal server error." });
      else response.destroy();
    });
  });

  server.on("upgrade", (request, socket, head) => {
    if (!isTrustedPublicRequest(request, options.publicOrigin)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    if (state.kind === "uninitialized") {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    const token = cookieValue(request, SESSION_COOKIE);
    if (token === undefined || !sessions.has(token, state.revision)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    proxyUpgrade(request, socket, head, options.upstreamOrigin, upgradedSockets);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;

  return {
    close: async () => {
      for (const socket of upgradedSockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
        server.closeAllConnections();
      });
    },
    origin: new URL(`http://${address.address}:${String(address.port)}`),
  };
}
