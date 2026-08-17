import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/password.js";
import { AlreadyInitializedError, AuthStateStore, InvalidAuthStateError } from "../src/state.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dotdsh-auth-state-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("password state", () => {
  it("stores only a restrictive scrypt hash", async () => {
    const directory = await temporaryDirectory();
    const store = new AuthStateStore(directory);
    const password = "correct horse battery staple";
    const passwordHash = await hashPassword(password);

    expect(await store.read()).toEqual({ kind: "uninitialized" });
    await store.initialize(passwordHash);

    const state = await store.read();
    expect(state.kind).toBe("initialized");
    if (state.kind !== "initialized") throw new Error("expected initialized state");
    expect(await verifyPassword(password, state.passwordHash)).toBe(true);
    expect(await verifyPassword("wrong password", state.passwordHash)).toBe(false);

    const statePath = join(directory, "state.json");
    expect(await readFile(statePath, "utf8")).not.toContain(password);
    expect((await stat(statePath)).mode & 0o777).toBe(0o600);
  });

  it("allows exactly one first-run initializer", async () => {
    const directory = await temporaryDirectory();
    const store = new AuthStateStore(directory);
    const firstHash = await hashPassword("first password is long");
    const secondHash = await hashPassword("second password is long");

    const results = await Promise.allSettled([store.initialize(firstHash), store.initialize(secondHash)]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({ reason: expect.any(AlreadyInitializedError) });
  });

  it("fails closed instead of reopening setup for invalid state", async () => {
    const directory = await temporaryDirectory();
    const statePath = join(directory, "state.json");
    await writeFile(statePath, "{not-json", { mode: 0o600 });
    const store = new AuthStateStore(directory);

    await expect(store.read()).rejects.toBeInstanceOf(InvalidAuthStateError);

    await writeFile(statePath, JSON.stringify({ version: 1, passwordHash: "bad", revision: 1 }));
    await chmod(statePath, 0o644);
    await expect(store.read()).rejects.toBeInstanceOf(InvalidAuthStateError);
  });
});
