import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { KeyringApi } from "./api.ts";
import { Keyring } from "./service.ts";
import { Store } from "./store.ts";

export const ADMIN = "admin-secret";
export const AGENT = "agent-secret";
export const RESOLVER = "resolver-secret";
export const KEY = Buffer.alloc(32, 7);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
});

/** A temporary folder, removed after the test. */
export function temp(prefix = "keyring-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export interface Init {
  method?: string;
  headers?: Record<string, string>;
  json?: unknown;
}

/**
 * The API on a database in memory (or at `db`), with the plain token `agent`,
 * the resolver token `agency` and the environment's admin token.
 */
export function setup(options: { db?: string; now?: () => Date } = {}) {
  const store = Store.open(options.db ?? ":memory:");
  store.putToken("agent", AGENT, { admin: false, resolver: false }, new Date());
  store.putToken("agency", RESOLVER, { admin: false, resolver: true }, new Date());
  const keyring = new Keyring(store, KEY, options.now);
  const api = new KeyringApi(keyring, { version: "0.1.0", commit: "abc123" }, { adminToken: ADMIN });
  cleanups.push(() => store.close());
  const fetch = (path: string, init: Init = {}) =>
    api.fetch(
      new Request(`http://keyring.test${path}`, {
        method: init.method ?? "GET",
        headers: { ...(init.json !== undefined && { "content-type": "application/json" }), ...init.headers },
        body: init.json !== undefined ? JSON.stringify(init.json) : null,
      }),
    );
  const bearer = (token = AGENT) => ({ authorization: `Bearer ${token}` });
  /** Calls as `token` and answers the status and JSON. */
  const call = async <T = Record<string, unknown>>(method: string, path: string, json?: unknown, token = AGENT) => {
    const res = await fetch(path, { method, headers: bearer(token), json });
    return { status: res.status, body: (await res.json()) as T };
  };
  const put = (name: string, value: string, description?: string) => call("PUT", `/api/secrets/${name}`, { value, ...(description && { description }) });
  const grant = (secret: string, variable: string, target: string) => call<{ id: string }>("POST", "/api/grants", { secret, variable, target }, ADMIN);
  const resolve = (session: { agent: string; role?: string; labels?: string[] }, token = RESOLVER) => call<{ variables: Record<string, string> }>("POST", "/api/resolve", session, token);
  return { api, store, keyring, fetch, bearer, call, put, grant, resolve };
}
