import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { link, open, readFile, rename, rm } from 'node:fs/promises';
import { promisify } from 'node:util';

const derive = promisify(
  (
    code: string,
    salt: string,
    length: number,
    callback: (error: Error | null, key: Buffer) => void,
  ) => scrypt(code, salt, length, callback),
);
const keyLength = 32;

export interface AccessCodeVerifier {
  salt: string;
  digest: string;
}

export async function createAccessCodeVerifier(code: string): Promise<AccessCodeVerifier> {
  const salt = randomBytes(16).toString('hex');
  const digest = (await derive(code, salt, keyLength)).toString('hex');
  return { salt, digest };
}

export async function verifyAccessCode(code: string, verifier: AccessCodeVerifier) {
  if (code.length < 16 || code.length > 256) {
    return false;
  }

  const digest = await derive(code, verifier.salt, keyLength);
  return timingSafeEqual(digest, Buffer.from(verifier.digest, 'hex'));
}

export async function readAccessCodeVerifier(path: string): Promise<AccessCodeVerifier> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));

  if (
    !value ||
    typeof value !== 'object' ||
    !('salt' in value) ||
    typeof value.salt !== 'string' ||
    !/^[0-9a-f]{32}$/.test(value.salt) ||
    !('digest' in value) ||
    typeof value.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.digest)
  ) {
    throw new Error('Invalid Beluga access credential.');
  }

  return { salt: value.salt, digest: value.digest };
}

export async function issueAccessCode(path: string, rotate: boolean) {
  if (rotate) {
    await readAccessCodeVerifier(path);
  }

  const code = randomBytes(24).toString('base64url');
  const verifier = await createAccessCodeVerifier(code);
  const temporary = `${path}.${crypto.randomUUID()}`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(verifier));
    } finally {
      await file.close();
    }
    if (rotate) {
      await rename(temporary, path);
    } else {
      await link(temporary, path);
    }
  } finally {
    await rm(temporary, { force: true });
  }

  return code;
}
