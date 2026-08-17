import type { IncomingMessage, ServerResponse } from "node:http";

export const SESSION_COOKIE = "dsh_auth_session";
const MAX_FORM_BYTES = 8 * 1024;

export class InvalidRequestError extends Error {
  override readonly name = "InvalidRequestError";
}

export function cookieValue(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

export function sessionCookie(token: string, ttlSeconds: number): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    `Max-Age=${String(ttlSeconds)}`,
    "Path=/",
    "SameSite=Strict",
    "Secure",
  ].join("; ");
}

export function clearSessionCookie(): string {
  return [`${SESSION_COOKIE}=`, "HttpOnly", "Max-Age=0", "Path=/", "SameSite=Strict", "Secure"].join("; ");
}

export function isHtmlNavigation(request: IncomingMessage): boolean {
  return request.method === "GET" && request.headers.accept?.includes("text/html") === true;
}

export function isTrustedPublicAuthority(request: IncomingMessage, publicOrigin: URL): boolean {
  if (request.headers.host !== publicOrigin.host) return false;
  return request.headers["sec-fetch-site"] !== "cross-site";
}

export function isTrustedPublicRequest(request: IncomingMessage, publicOrigin: URL): boolean {
  if (!isTrustedPublicAuthority(request, publicOrigin)) return false;
  const origin = request.headers.origin;
  return origin === undefined || origin === publicOrigin.origin;
}

export async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  if (request.headers["content-type"]?.split(";", 1)[0]?.trim() !== "application/x-www-form-urlencoded") {
    throw new InvalidRequestError("Expected a form submission.");
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_FORM_BYTES) throw new InvalidRequestError("Form submission is too large.");
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export function safeNextPath(value: string | null): string {
  if (value === null || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(html);
}

export function sendJson(response: ServerResponse, status: number, payload: Readonly<Record<string, string>>): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

export function redirect(response: ServerResponse, location: string, cookie?: string): void {
  response.writeHead(303, {
    "cache-control": "no-store",
    location,
    ...(cookie === undefined ? {} : { "set-cookie": cookie }),
  });
  response.end();
}
