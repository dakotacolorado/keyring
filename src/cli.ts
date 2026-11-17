#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { banner, SUMMARY, TAGLINE } from "./banner.ts";
import { PACKAGE_VERSION } from "./build.ts";
import { parseKey } from "./crypto.ts";
import { TOKEN_NAME } from "./domain.ts";
import { start } from "./server.ts";
import { Keyring } from "./service.ts";
import { Store } from "./store.ts";

const USAGE = `keyring v${PACKAGE_VERSION}: ${TAGLINE}
${SUMMARY}

Usage:
  keyring [serve] [--dev] [options]   run the server; --dev takes the admin token "dev" and an all-zero
                                      master key when KEYRING_ADMIN_TOKEN and KEYRING_MASTER_KEY are unset
  keyring backup <file>               copy the database, consistent while the server runs, to a new <file>;
                                      it holds only ciphertext, so it is safe to keep off the host
  keyring rekey                       re-seal every value under KEYRING_NEW_MASTER_KEY, with the server
                                      stopped; start it again with that key as KEYRING_MASTER_KEY

  keyring token create <name> [--admin] [--resolver]
                                      make a token named <name>, printed once; --admin lets it manage
                                      grants, --resolver lets it resolve values
  keyring token list                  list tokens (never their secrets)
  keyring token revoke <name>         revoke a token

Options:
  --host <addr>       address to listen on (default 127.0.0.1, or KEYRING_HOST)
  --port <n>          port (default 4830, or KEYRING_PORT)
  --db <path>         the SQLite database (default ~/.local/share/keyring/keyring.db, or KEYRING_DB)
  --public-url <url>  where people and agents reach it, for the banner (default where it listens,
                      or KEYRING_PUBLIC_URL)
  -h, --help          this

Environment:
  KEYRING_MASTER_KEY      the key every value is sealed under: 32 bytes in hex (openssl rand -hex 32)
  KEYRING_NEW_MASTER_KEY  the key keyring rekey moves to
  KEYRING_ADMIN_TOKEN     one more token, named "admin", an admin's that cannot resolve

/health, /openapi.json, /mcp.json and the docs at /docs/api and /docs/mcp need no
token; everything else takes one. /mcp is the MCP server, for the person and agents.
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    host: { type: "string" },
    port: { type: "string" },
    db: { type: "string" },
    "public-url": { type: "string" },
    admin: { type: "boolean" },
    resolver: { type: "boolean" },
    dev: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const fail = (message: string): never => {
  process.stderr.write(`keyring: ${message}\n`);
  process.exit(1);
};
const say = (line: string) => process.stdout.write(`${line}\n`);

if (values.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const env = process.env;
const db = values.db ?? env.KEYRING_DB ?? join(homedir(), ".local", "share", "keyring", "keyring.db");
const path = db === ":memory:" ? db : resolve(db);
if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
const [command = "serve", ...rest] = positionals;
const dev = values.dev === true;

/** The master key from the environment, or dev's all-zero one; exits saying why when it is unusable. */
function masterKey(name = "KEYRING_MASTER_KEY"): Buffer {
  if (dev && name === "KEYRING_MASTER_KEY" && !env[name]) return Buffer.alloc(32);
  try {
    return parseKey(env[name], name);
  } catch (err) {
    return fail((err as Error).message);
  }
}

/** Runs `fn` on the database, then closes it and exits. */
function withStore(fn: (store: Store) => void): never {
  const store = Store.open(path);
  try {
    fn(store);
  } catch (err) {
    store.close();
    fail((err as Error).message);
  }
  store.close();
  process.exit(0);
}

if (command === "backup") {
  const [file] = rest;
  if (!file) fail("backup needs the file to write");
  withStore((store) => {
    store.backup(resolve(file!));
    say(`backed up ${path} to ${resolve(file!)}`);
  });
}

if (command === "rekey") {
  const key = masterKey();
  const next = masterKey("KEYRING_NEW_MASTER_KEY");
  if (key.equals(next)) fail("KEYRING_NEW_MASTER_KEY is the key already in use");
  withStore((store) => {
    const count = new Keyring(store, key).rekey(next);
    say(`re-sealed ${count} secret${count === 1 ? "" : "s"} under KEYRING_NEW_MASTER_KEY; start keyring with it as KEYRING_MASTER_KEY`);
  });
}

if (command === "token") {
  const [action, name] = rest;
  withStore((store) => {
    if (action === "create") {
      if (!name || !TOKEN_NAME.test(name)) fail(`token create needs a name: lowercase letters, digits, ".", "_" or "-", as ${TOKEN_NAME}`);
      if (name === "admin") fail('"admin" is KEYRING_ADMIN_TOKEN\'s name; choose another');
      const token = randomBytes(32).toString("base64url");
      const rights = { admin: values.admin === true, resolver: values.resolver === true };
      store.putToken(name!, token, rights, new Date());
      const can = [rights.admin && "admin", rights.resolver && "resolver"].filter(Boolean).join(", ") || "plain";
      process.stderr.write(`keyring: made token "${name}" (${can}); it is shown once:\n`);
      say(token);
    } else if (action === "list") {
      const tokens = store.tokens();
      if (!tokens.length) say("no tokens: make one with keyring token create <name>");
      for (const t of tokens) {
        const can = [t.admin && "admin", t.resolver && "resolver"].filter(Boolean).join(",") || "plain";
        say(`${t.name}\t${can}\tmade ${t.createdAt}\t${t.lastUsedAt ? `last used ${t.lastUsedAt}` : "never used"}`);
      }
    } else if (action === "revoke") {
      if (!name) fail("token revoke needs the token's name");
      if (!store.revokeToken(name!)) fail(`no token named "${name}"`);
      say(`revoked "${name}"`);
    } else fail("token takes create, list or revoke");
  });
}

if (command !== "serve") fail(`unknown command "${command}"\n\n${USAGE}`);

const host = values.host ?? env.KEYRING_HOST ?? "127.0.0.1";
const portSetting = values.port ?? env.KEYRING_PORT;
const port = Number(portSetting ?? 4830);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`--port must be a port number, not ${portSetting}`);
const publicUrl = (values["public-url"] ?? env.KEYRING_PUBLIC_URL ?? "").replace(/\/+$/, "") || null;
if (publicUrl && !/^https?:\/\/[^/]+(\/.*)?$/.test(publicUrl)) fail(`--public-url must be an http(s) URL, not ${publicUrl}`);

const key = masterKey();
const adminToken = env.KEYRING_ADMIN_TOKEN || (dev ? "dev" : null);
let running: ReturnType<typeof start>;
try {
  running = start({ db: path, key, adminToken });
} catch (err) {
  fail((err as Error).message);
}
const shown = (at: number) => `http://${host.includes(":") ? `[${host}]` : host}:${at}`;
const server = serve({ fetch: running!.api.fetch, hostname: host, port }, (info) => {
  const notes = [
    ...(dev && !env.KEYRING_ADMIN_TOKEN ? ['Sign in with the admin token "dev".'] : []),
    ...(dev && !env.KEYRING_MASTER_KEY ? ["Sealing under the all-zero dev key: nothing here is secret."] : []),
    ...(!adminToken && !running.store.tokens().length ? ["No token: set KEYRING_ADMIN_TOKEN, or make one with keyring token create <name>."] : []),
  ];
  const color = Boolean(process.stdout.isTTY) && !env.NO_COLOR;
  process.stdout.write(banner({ version: PACKAGE_VERSION, url: shown(info.port), publicUrl: publicUrl ?? shown(info.port), db: path, notes, color }));
});

server.on("error", (err) => {
  running.close();
  fail(`cannot serve on ${host}:${port}: ${err.message}`);
});

const stop = () => {
  server.close();
  running.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
