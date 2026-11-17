import { describe, expect, it } from "vitest";
import { contextOf, KeyError, open, parseKey, seal } from "./crypto.ts";

const key = Buffer.alloc(32, 1);
const other = Buffer.alloc(32, 2);

describe("sealing", () => {
  it("round-trips a value, unicode and a whole file too", () => {
    for (const value of ["sk-ant-oat01-abcdef", "pässwörd ✓", "[default]\naws_access_key_id = AKIA…\n".repeat(50)]) {
      expect(open(key, seal(key, value, contextOf("x", 1)), contextOf("x", 1))).toBe(value);
    }
  });

  it("holds no plaintext, and seals one value differently each time", () => {
    const a = seal(key, "plain-text-value", "c");
    const b = seal(key, "plain-text-value", "c");
    expect(Buffer.from(a).toString("latin1")).not.toContain("plain-text-value");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    // Format byte, 12-byte nonce, 16-byte tag, then as many bytes as the value.
    expect(a.length).toBe(1 + 12 + 16 + "plain-text-value".length);
  });

  it("fails clearly under a wrong key", () => {
    const sealed = seal(key, "v", "c");
    expect(() => open(other, sealed, "c")).toThrow(KeyError);
    expect(() => open(other, sealed, "c")).toThrow(/does not open under KEYRING_MASTER_KEY/);
  });

  it("does not open as another secret, or another version, or once changed", () => {
    const sealed = seal(key, "v", contextOf("a", 1));
    expect(() => open(key, sealed, contextOf("b", 1))).toThrow(KeyError);
    expect(() => open(key, sealed, contextOf("a", 2))).toThrow(KeyError);
    const changed = new Uint8Array(sealed);
    changed[changed.length - 1]! ^= 1;
    expect(() => open(key, changed, contextOf("a", 1))).toThrow(KeyError);
  });
});

describe("parseKey", () => {
  it("takes 32 bytes in hex, and nothing else", () => {
    expect(parseKey("ab".repeat(32))).toEqual(Buffer.alloc(32, 0xab));
    expect(() => parseKey(undefined)).toThrow(/KEYRING_MASTER_KEY is not set/);
    expect(() => parseKey("ab".repeat(16))).toThrow(/32 bytes in hex, 64 characters; it is 32/);
    expect(() => parseKey("zz".repeat(32), "KEYRING_NEW_MASTER_KEY")).toThrow(/^KEYRING_NEW_MASTER_KEY must be/);
  });
});
