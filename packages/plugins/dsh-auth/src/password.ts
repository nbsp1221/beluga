import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const ALGORITHM = "scrypt";
const COST = 65_536;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 128 * 1024 * 1024;
const MINIMUM_PASSWORD_LENGTH = 12;

interface ParsedPasswordHash {
  digest: Buffer;
  salt: Buffer;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: COST,
        maxmem: MAX_MEMORY,
        p: PARALLELIZATION,
        r: BLOCK_SIZE,
      },
      (error, derivedKey) => {
        if (error === null) resolve(derivedKey);
        else reject(error);
      },
    );
  });
}

function parsePasswordHash(value: string): ParsedPasswordHash | undefined {
  const [algorithm, cost, blockSize, parallelization, salt, digest, ...extra] = value.split("$");
  if (
    algorithm !== ALGORITHM ||
    cost !== String(COST) ||
    blockSize !== String(BLOCK_SIZE) ||
    parallelization !== String(PARALLELIZATION) ||
    salt === undefined ||
    digest === undefined ||
    extra.length > 0
  ) {
    return undefined;
  }

  try {
    const decodedSalt = Buffer.from(salt, "base64url");
    const decodedDigest = Buffer.from(digest, "base64url");
    if (decodedSalt.length !== 16 || decodedDigest.length !== KEY_LENGTH) return undefined;
    return { digest: decodedDigest, salt: decodedSalt };
  } catch {
    return undefined;
  }
}

export function isPasswordHash(value: string): boolean {
  return parsePasswordHash(value) !== undefined;
}

export function validatePassword(password: string): string | undefined {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return `Password must contain at least ${String(MINIMUM_PASSWORD_LENGTH)} characters.`;
  }
  return undefined;
}

export async function hashPassword(password: string): Promise<string> {
  const validationError = validatePassword(password);
  if (validationError !== undefined) throw new Error(validationError);
  const salt = randomBytes(16);
  const digest = await derive(password, salt);
  return [
    ALGORITHM,
    String(COST),
    String(BLOCK_SIZE),
    String(PARALLELIZATION),
    salt.toString("base64url"),
    digest.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (parsed === undefined) return false;
  const actual = await derive(password, parsed.salt);
  return timingSafeEqual(actual, parsed.digest);
}
