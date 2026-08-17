import { constants } from "node:fs";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isPasswordHash } from "./password.js";

const STATE_FILENAME = "state.json";

export interface AuthState {
  passwordHash: string;
  revision: number;
  version: 1;
}

export type AuthStateResult =
  | { kind: "initialized"; passwordHash: string; revision: number }
  | { kind: "uninitialized" };

export class AlreadyInitializedError extends Error {
  override readonly name = "AlreadyInitializedError";
}

export class InvalidAuthStateError extends Error {
  override readonly name = "InvalidAuthStateError";
}

function parseState(value: string): AuthState {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch (error) {
    throw new InvalidAuthStateError("Authentication state is not valid JSON.", {
      cause: error,
    });
  }

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("version" in candidate) ||
    candidate.version !== 1 ||
    !("revision" in candidate) ||
    !Number.isSafeInteger(candidate.revision) ||
    Number(candidate.revision) < 1 ||
    !("passwordHash" in candidate) ||
    typeof candidate.passwordHash !== "string" ||
    !isPasswordHash(candidate.passwordHash)
  ) {
    throw new InvalidAuthStateError("Authentication state does not match version 1.");
  }

  return {
    passwordHash: candidate.passwordHash,
    revision: Number(candidate.revision),
    version: 1,
  };
}

export class AuthStateStore {
  readonly #directory: string;
  readonly #path: string;

  constructor(directory: string) {
    this.#directory = directory;
    this.#path = join(directory, STATE_FILENAME);
  }

  async read(): Promise<AuthStateResult> {
    let metadata: Awaited<ReturnType<typeof stat>>;
    try {
      metadata = await stat(this.#path);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return { kind: "uninitialized" };
      }
      throw error;
    }

    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
      throw new InvalidAuthStateError("Authentication state must be a private regular file.");
    }

    const state = parseState(await readFile(this.#path, "utf8"));
    return {
      kind: "initialized",
      passwordHash: state.passwordHash,
      revision: state.revision,
    };
  }

  async initialize(passwordHash: string): Promise<void> {
    if (!isPasswordHash(passwordHash)) {
      throw new InvalidAuthStateError("Cannot persist an invalid password hash.");
    }
    await mkdir(this.#directory, { mode: 0o700, recursive: true });

    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(this.#path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
        throw new AlreadyInitializedError("Authentication is already initialized.");
      }
      throw error;
    }

    try {
      const state: AuthState = { passwordHash, revision: 1, version: 1 };
      await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
