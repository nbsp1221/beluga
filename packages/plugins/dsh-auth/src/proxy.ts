import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { SESSION_COOKIE } from "./http.js";

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
] as const;

function forwardedCookie(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const kept = value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => !part.startsWith(`${SESSION_COOKIE}=`));
  return kept.length === 0 ? undefined : kept.join("; ");
}

function upstreamHeaders(request: IncomingMessage, upstreamOrigin: URL, upgrade: boolean): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = { ...request.headers };
  for (const name of HOP_BY_HOP_HEADERS) delete headers[name];
  delete headers.cookie;
  delete headers.origin;
  delete headers.host;
  delete headers.upgrade;

  const cookie = forwardedCookie(request.headers.cookie);
  if (cookie !== undefined) headers.cookie = cookie;
  headers.host = upstreamOrigin.host;
  headers.origin = upstreamOrigin.origin;
  if (upgrade) {
    headers.connection = "Upgrade";
    headers.upgrade = request.headers.upgrade ?? "websocket";
  }
  return headers;
}

export function proxyHttp(request: IncomingMessage, response: ServerResponse, upstreamOrigin: URL): void {
  const target = new URL(request.url ?? "/", upstreamOrigin);
  const upstream = httpRequest(
    target,
    {
      headers: upstreamHeaders(request, upstreamOrigin, false),
      method: request.method,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.once("error", (error) => {
    if (response.headersSent) response.destroy(error);
    else {
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end("Bad Gateway");
    }
  });
  request.once("aborted", () => upstream.destroy());
  request.pipe(upstream);
}

function rawResponseHead(response: IncomingMessage): string {
  const status = response.statusCode ?? 502;
  const message = response.statusMessage ?? "Bad Gateway";
  const headers: string[] = [];
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    headers.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
  }
  return [`HTTP/1.1 ${String(status)} ${message}`, ...headers, "", ""].join("\r\n");
}

export function proxyUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  upstreamOrigin: URL,
  upgradedSockets: Set<Duplex>,
): void {
  const target = new URL(request.url ?? "/", upstreamOrigin);
  const upstreamRequest = httpRequest(target, {
    headers: upstreamHeaders(request, upstreamOrigin, true),
    method: request.method,
  });

  upstreamRequest.once("upgrade", (response, upstreamSocket, upstreamHead) => {
    upgradedSockets.add(socket);
    upgradedSockets.add(upstreamSocket);
    const cleanup = () => {
      upgradedSockets.delete(socket);
      upgradedSockets.delete(upstreamSocket);
    };
    socket.once("close", () => {
      if (!upstreamSocket.destroyed) upstreamSocket.destroy();
      cleanup();
    });
    upstreamSocket.once("close", () => {
      if (!socket.destroyed) socket.destroy();
      cleanup();
    });
    socket.once("end", () => upstreamSocket.destroy());
    upstreamSocket.once("end", () => socket.destroy());
    socket.once("error", () => upstreamSocket.destroy());
    upstreamSocket.once("error", () => socket.destroy());
    socket.write(rawResponseHead(response));
    if (upstreamHead.length > 0) socket.write(upstreamHead);
    if (head.length > 0) upstreamSocket.write(head);
    socket.pipe(upstreamSocket, { end: false });
    upstreamSocket.pipe(socket, { end: false });
  });

  upstreamRequest.once("response", (response) => {
    socket.write(rawResponseHead(response));
    response.pipe(socket);
  });
  upstreamRequest.once("error", () => {
    socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  });
  upstreamRequest.end();
}
