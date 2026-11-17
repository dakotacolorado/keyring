import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Sealing a value under the master key: AES-256-GCM, a random 12-byte nonce
 * for each value, and the value's name and version as associated data, so a
 * sealed value moved to another row does not open.
 *
 * A sealed value is one byte string: format byte, nonce, tag, ciphertext.
 */

const FORMAT = 1;
const NONCE = 12;
const TAG = 16;

/** The master key is wrong for what it is asked to open, or what it opens was changed. */
export class KeyError extends Error {}

/** The master key from its hex: 32 bytes, 64 hex characters. */
export function parseKey(hex: string | undefined, name = "KEYRING_MASTER_KEY"): Buffer {
  if (!hex) throw new KeyError(`${name} is not set: give 32 random bytes in hex (openssl rand -hex 32).`);
  if (!/^[0-9a-fA-F]{64}$/.test(hex.trim())) throw new KeyError(`${name} must be 32 bytes in hex, 64 characters; it is ${hex.trim().length} characters.`);
  return Buffer.from(hex.trim(), "hex");
}

export function seal(key: Buffer, plaintext: string, context: string): Uint8Array {
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return new Uint8Array(Buffer.concat([Buffer.from([FORMAT]), nonce, cipher.getAuthTag(), body]));
}

export function open(key: Buffer, sealed: Uint8Array, context: string): string {
  const bytes = Buffer.from(sealed);
  if (bytes[0] !== FORMAT || bytes.length < 1 + NONCE + TAG) throw new KeyError("A sealed value is not in keyring's format.");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(1, 1 + NONCE));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(bytes.subarray(1 + NONCE, 1 + NONCE + TAG));
  try {
    return Buffer.concat([decipher.update(bytes.subarray(1 + NONCE + TAG)), decipher.final()]).toString("utf8");
  } catch {
    throw new KeyError("A sealed value does not open under KEYRING_MASTER_KEY: the key is wrong, or the value was changed.");
  }
}

/** What a value's associated data is: its name and version. */
export const contextOf = (name: string, version: number) => `secret:${name}:${version}`;

/** The context of the value that proves which key a database is sealed under. */
export const CHECK_CONTEXT = "keyring:key-check";
export const CHECK_TEXT = "keyring";
