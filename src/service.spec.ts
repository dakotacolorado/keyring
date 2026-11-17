import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KeyError } from "./crypto.ts";
import { Keyring } from "./service.ts";
import { Store } from "./store.ts";
import { KEY, temp } from "./testing.ts";

const who = { token: "agent", actor: null };
const VALUE = "plaintext-canary-7d1e0c2b9f";

/** Every byte keyring wrote under `dir`: the database, its WAL and anything beside it. */
const bytesUnder = (dir: string) => readdirSync(dir).map((name) => readFileSync(join(dir, name)).toString("latin1")).join("");

describe("the database", () => {
  it("holds no plaintext value, in its file or its WAL, open or closed", () => {
    const dir = temp();
    const store = Store.open(join(dir, "keyring.db"));
    const keyring = new Keyring(store, KEY);
    keyring.put("CANARY", { value: VALUE, description: "a test" }, who);
    keyring.put("CANARY", { value: `${VALUE}-2` }, who);
    keyring.grant({ secret: "CANARY", variable: "CANARY", target: "all" }, who);
    keyring.resolve({ agent: "a" }, who);
    expect(bytesUnder(dir)).toContain("CANARY");
    expect(bytesUnder(dir)).not.toContain("plaintext-canary");
    store.close();
    expect(bytesUnder(dir)).not.toContain("plaintext-canary");
    const backup = join(temp(), "copy.db");
    Store.open(join(dir, "keyring.db")).backup(backup);
    expect(readFileSync(backup).toString("latin1")).not.toContain("plaintext-canary");
  });

  it("refuses to open under a key other than the one it was made with, saying so", () => {
    const db = join(temp(), "keyring.db");
    const store = Store.open(db);
    new Keyring(store, KEY).put("A", { value: VALUE }, who);
    store.close();
    const again = Store.open(db);
    expect(() => new Keyring(again, Buffer.alloc(32, 9))).toThrow(KeyError);
    expect(() => new Keyring(again, Buffer.alloc(32, 9))).toThrow(/KEYRING_MASTER_KEY is not the key this database's secrets are sealed under/);
    expect(new Keyring(again, KEY).resolve({ agent: "a" }, who)).toEqual({});
    again.close();
  });

  it("counts versions, keeping who made it and when", () => {
    let t = 0;
    const keyring = new Keyring(Store.open(":memory:"), KEY, () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)));
    expect(keyring.put("A", { value: "1", description: "first" }, { token: "x", actor: "alice" })).toMatchObject({ created: true, secret: { version: 1, createdBy: "alice" } });
    const { secret, created } = keyring.put("A", { value: "2" }, { token: "y", actor: null });
    expect(created).toBe(false);
    expect(secret).toMatchObject({ version: 2, description: "first", createdBy: "alice", updatedBy: "y", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:02.000Z" });
    expect(keyring.put("A", { value: "3", description: null }, who).secret.description).toBeNull();
  });
});

describe("rekey", () => {
  it("re-seals every value under the new key: the old one opens nothing after, and values and grants are kept", () => {
    const db = join(temp(), "keyring.db");
    const next = Buffer.alloc(32, 8);
    const store = Store.open(db);
    const keyring = new Keyring(store, KEY);
    keyring.put("A", { value: "alpha" }, who);
    keyring.put("B", { value: "bravo" }, who);
    keyring.grant({ secret: "A", variable: "A", target: "all" }, who);
    keyring.grant({ secret: "B", variable: "B", target: "role:r" }, who);
    const before = store.secrets().map((row) => Buffer.from(row.sealed));
    expect(keyring.rekey(next)).toBe(2);
    // The running keyring moves to the new key.
    expect(keyring.resolve({ agent: "a", role: "r" }, who)).toEqual({ A: "alpha", B: "bravo" });
    expect(store.secrets().map((row) => Buffer.from(row.sealed)).some((sealed, i) => sealed.equals(before[i]!))).toBe(false);
    store.close();
    const reopened = Store.open(db);
    expect(() => new Keyring(reopened, KEY)).toThrow(/not the key/);
    expect(new Keyring(reopened, next).resolve({ agent: "a", role: "r" }, who)).toEqual({ A: "alpha", B: "bravo" });
    reopened.close();
  });

  it("changes nothing when a value does not open", () => {
    const store = Store.open(":memory:");
    const keyring = new Keyring(store, KEY);
    keyring.put("A", { value: "alpha" }, who);
    store.resealSecret("A", new Uint8Array([1, ...new Uint8Array(40)]));
    const check = Buffer.from(store.meta("key-check")!);
    expect(() => keyring.rekey(Buffer.alloc(32, 8))).toThrow(KeyError);
    expect(Buffer.from(store.meta("key-check")!).equals(check)).toBe(true);
    expect(() => new Keyring(store, KEY)).not.toThrow();
  });
});
