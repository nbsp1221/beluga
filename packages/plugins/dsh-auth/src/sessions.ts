import { createHash, randomBytes } from "node:crypto";

interface Session {
  expiresAt: number;
  revision: number;
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export class SessionStore {
  readonly #sessions = new Map<string, Session>();
  readonly #ttlMilliseconds: number;

  constructor(ttlSeconds: number) {
    this.#ttlMilliseconds = ttlSeconds * 1000;
  }

  create(revision: number): string {
    this.#prune();
    const token = randomBytes(32).toString("base64url");
    this.#sessions.set(digest(token), {
      expiresAt: Date.now() + this.#ttlMilliseconds,
      revision,
    });
    return token;
  }

  delete(token: string): void {
    this.#sessions.delete(digest(token));
  }

  has(token: string, revision: number): boolean {
    const session = this.#sessions.get(digest(token));
    if (session === undefined) return false;
    if (session.expiresAt <= Date.now() || session.revision !== revision) {
      this.#sessions.delete(digest(token));
      return false;
    }
    return true;
  }

  #prune(): void {
    const now = Date.now();
    for (const [key, session] of this.#sessions) {
      if (session.expiresAt <= now) this.#sessions.delete(key);
    }
  }
}
