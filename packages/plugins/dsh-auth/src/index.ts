import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import type {} from "@deepseek-ai/dsh-host-webserver";
import z from "@deepseek-ai/schemastery";
import { startAuthServer } from "./auth-server.js";

export interface Config {
  host: "0.0.0.0" | "127.0.0.1";
  loginLockSeconds: number;
  maxLoginAttempts: number;
  port: number;
  publicOrigin: string;
  sessionTtlSeconds: number;
  stateDirectory: string;
}

export const Config: z<Config> = z.object({
  host: z.union(["0.0.0.0", "127.0.0.1"]).default("127.0.0.1"),
  loginLockSeconds: z.number().min(1).default(300),
  maxLoginAttempts: z.number().min(1).default(10),
  port: z.number().min(0).max(65_535).default(3080),
  publicOrigin: z.string().default("http://127.0.0.1:3080"),
  sessionTtlSeconds: z.number().min(60).default(604_800),
  stateDirectory: z.string().default(""),
});

export const inject = ["webServer"];
export const name = "dotdsh-auth";

export async function apply(ctx: Context, config: Config): Promise<void> {
  if (ctx.webServer.host !== "127.0.0.1") {
    throw new Error("dotdsh-auth requires the DSH web server to bind to loopback.");
  }
  const publicOrigin = new URL(config.publicOrigin);
  if (!["http:", "https:"].includes(publicOrigin.protocol)) {
    throw new Error("dotdsh-auth publicOrigin must use HTTP or HTTPS.");
  }

  ctx.on("webserver/index-inject", (table) => {
    table.push({ kind: "global", name: "__DSH_REMOTE_ADMIN__", value: true });
  });

  const running = await startAuthServer({
    host: config.host,
    loginLockSeconds: config.loginLockSeconds,
    maxLoginAttempts: config.maxLoginAttempts,
    port: config.port,
    publicOrigin,
    sessionTtlSeconds: config.sessionTtlSeconds,
    stateDirectory: config.stateDirectory === "" ? join(resolveDshHome(), "auth") : config.stateDirectory,
    upstreamOrigin: new URL(`http://${ctx.webServer.host}:${String(ctx.webServer.port)}`),
  });

  ctx.effect(() => async () => await running.close(), "dotdsh-auth: public listener");
}
