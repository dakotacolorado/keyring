import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Keyring } from "./service.ts";
import { Store } from "./store.ts";
import { temp } from "./testing.ts";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));
const KEY = "11".repeat(32);
const NEXT = "22".repeat(32);
/** The test's environment without any service's address or token, nor keyring's own settings. */
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_(URL|TOKEN)$/.test(k) && !k.startsWith("KEYRING_")));

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

/** Starts the server on a port the OS picks; answers its address once it says it listens. */
function serve(args: string[], env: Record<string, string> = {}): Promise<{ url: string; out: () => string }> {
  const child = spawn(process.execPath, [CLI, ...args, "--port", "0"], { env: { ...clean(), ...env } });
  children.push(child);
  let out = "";
  return new Promise((ready, fail) => {
    child.stdout.on("data", (d) => {
      out += d;
      const url = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(out)?.[1];
      if (url) ready({ url, out: () => out });
    });
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => fail(new Error(`exited ${code}: ${out}`)));
  });
}

/** Runs one command to its end. */
const run = (args: string[], env: Record<string, string> = {}) => {
  const result = spawnSync(process.execPath, [CLI, ...args], { env: { ...clean(), ...env }, encoding: "utf8" });
  return { status: result.status, out: result.stdout, err: result.stderr };
};

describe("keyring serve", () => {
  it("serves the database it is given under KEYRING_MASTER_KEY, taking KEYRING_ADMIN_TOKEN", async () => {
    const dir = temp();
    const { url, out } = await serve(["serve"], { KEYRING_DB: join(dir, "db", "keyring.db"), KEYRING_MASTER_KEY: KEY, KEYRING_ADMIN_TOKEN: "scratch", KEYRING_PUBLIC_URL: "https://keyring.example.com/" });
    expect(out()).toContain("Every agent's keys on one ring, and only the ones it may use.");
    expect(out()).toContain("  ▸ API       https://keyring.example.com/api/secrets");
    expect(out()).not.toContain("\x1b");
    expect(existsSync(join(dir, "db", "keyring.db"))).toBe(true);
    expect(await (await fetch(`${url}/health`)).json()).toMatchObject({ ok: true, version: "0.1.0" });
    expect((await fetch(`${url}/api/secrets`)).status).toBe(401);
    expect((await fetch(`${url}/api/secrets`, { headers: { authorization: "Bearer scratch" } })).status).toBe(200);
  });

  it("refuses to start without a master key, or with a malformed one, or the wrong one", async () => {
    const db = join(temp(), "keyring.db");
    const none = run(["serve", "--db", db, "--port", "0"]);
    expect(none.status).toBe(1);
    expect(none.err).toContain("KEYRING_MASTER_KEY is not set");
    expect(run(["serve", "--db", db, "--port", "0"], { KEYRING_MASTER_KEY: "abc" }).err).toContain("must be 32 bytes in hex");
    const store = Store.open(db);
    new Keyring(store, Buffer.from(KEY, "hex"));
    store.close();
    const wrong = run(["serve", "--db", db, "--port", "0"], { KEYRING_MASTER_KEY: NEXT });
    expect(wrong.status).toBe(1);
    expect(wrong.err).toContain("KEYRING_MASTER_KEY is not the key this database's secrets are sealed under");
  });

  it("takes the admin token dev and a dev key under --dev, and says so", async () => {
    const dir = temp();
    const { url, out } = await serve(["serve", "--dev", "--db", join(dir, "keyring.db")]);
    expect(out()).toContain('Sign in with the admin token "dev".');
    expect(out()).toContain("all-zero dev key");
    expect((await fetch(`${url}/api/grants`, { headers: { authorization: "Bearer dev" } })).status).toBe(200);
  });
});

describe("keyring token", () => {
  it("creates plain, admin and resolver tokens, printed once, that the server takes as such; lists and revokes them", async () => {
    const dir = temp();
    const db = join(dir, "keyring.db");
    const make = (...args: string[]) => {
      const made = run(["token", "create", ...args, "--db", db]);
      expect(made.status).toBe(0);
      expect(made.out.trim()).toMatch(/^[\w-]{43}$/);
      return made.out.trim();
    };
    const plain = make("agents");
    const admin = make("ops", "--admin");
    const resolver = make("agency", "--resolver");
    expect(run(["token", "list", "--db", db]).out).toMatch(/^agency\tresolver\tmade .*\tnever used\nagents\tplain\t.*\nops\tadmin\t/);
    const { url } = await serve(["--db", db], { KEYRING_MASTER_KEY: KEY });
    const as = (token: string, path: string, init: RequestInit = {}) => fetch(`${url}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
    const resolve = { method: "POST", body: JSON.stringify({ agent: "a" }) };
    expect((await as(plain, "/api/grants")).status).toBe(403);
    expect((await as(admin, "/api/grants")).status).toBe(200);
    expect((await as(admin, "/api/resolve", resolve)).status).toBe(403);
    expect((await as(resolver, "/api/resolve", resolve)).status).toBe(200);
    expect(run(["token", "revoke", "agency", "--db", db]).status).toBe(0);
    expect((await as(resolver, "/api/resolve", resolve)).status).toBe(401);
    expect(run(["token", "revoke", "agency", "--db", db]).status).toBe(1);
  });

  it("refuses a bad name, and admin, which is KEYRING_ADMIN_TOKEN's", () => {
    const db = join(temp(), "keyring.db");
    expect(run(["token", "create", "Bad Name", "--db", db]).status).toBe(1);
    expect(run(["token", "create", "admin", "--db", db]).status).toBe(1);
  });
});

describe("keyring backup and rekey", () => {
  it("backs up to a new file holding only ciphertext, refusing to overwrite one", () => {
    const dir = temp();
    const db = join(dir, "keyring.db");
    const store = Store.open(db);
    new Keyring(store, Buffer.from(KEY, "hex")).put("A", { value: "backup-canary-value" }, { token: "t", actor: null });
    store.close();
    const copy = join(dir, "copy.db");
    expect(run(["backup", copy, "--db", db]).status).toBe(0);
    expect(readFileSync(copy).toString("latin1")).not.toContain("backup-canary");
    const reopened = Store.open(copy);
    expect(new Keyring(reopened, Buffer.from(KEY, "hex")).resolve({ agent: "x" }, { token: "t", actor: null })).toEqual({});
    expect(reopened.secrets().map((row) => row.name)).toEqual(["A"]);
    reopened.close();
    expect(run(["backup", copy, "--db", db]).err).toContain("exists");
  });

  it("re-seals every value under KEYRING_NEW_MASTER_KEY, after which the server takes only the new key", async () => {
    const dir = temp();
    const db = join(dir, "keyring.db");
    const store = Store.open(db);
    new Keyring(store, Buffer.from(KEY, "hex")).put("A", { value: "alpha" }, { token: "t", actor: null });
    store.close();
    expect(run(["rekey", "--db", db], { KEYRING_MASTER_KEY: KEY }).err).toContain("KEYRING_NEW_MASTER_KEY is not set");
    expect(run(["rekey", "--db", db], { KEYRING_MASTER_KEY: NEXT, KEYRING_NEW_MASTER_KEY: KEY }).err).toContain("not the key");
    const done = run(["rekey", "--db", db], { KEYRING_MASTER_KEY: KEY, KEYRING_NEW_MASTER_KEY: NEXT });
    expect(done.status).toBe(0);
    expect(done.out).toContain("re-sealed 1 secret under KEYRING_NEW_MASTER_KEY");
    expect(run(["serve", "--db", db, "--port", "0"], { KEYRING_MASTER_KEY: KEY }).err).toContain("not the key");
    const { url } = await serve(["--db", db], { KEYRING_MASTER_KEY: NEXT, KEYRING_ADMIN_TOKEN: "a" });
    expect((await fetch(`${url}/api/secrets/A`, { headers: { authorization: "Bearer a" } })).status).toBe(200);
  });
});
