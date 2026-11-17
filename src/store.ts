import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { RequestError, type AuditAction, type AuditEvent, type Grant } from "./domain.ts";

/**
 * Each entry brings a database from the shape before it to the one after;
 * `PRAGMA user_version` counts those applied. Append, never edit: a database
 * already past an entry never runs it again.
 */
export const MIGRATIONS: string[] = [
  `
CREATE TABLE meta (key TEXT PRIMARY KEY, value BLOB NOT NULL);
CREATE TABLE secrets (
  name TEXT PRIMARY KEY,
  description TEXT,
  version INTEGER NOT NULL,
  sealed BLOB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE grants (
  id TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  variable TEXT NOT NULL,
  target TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (variable, target)
);
CREATE INDEX grants_by_secret ON grants (secret);
CREATE TABLE tokens (
  name TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  admin INTEGER NOT NULL,
  resolver INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  token TEXT NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  secret TEXT,
  target TEXT,
  agent TEXT,
  role TEXT,
  labels TEXT,
  variables TEXT
);
CREATE INDEX audit_by_agent ON audit (agent, id DESC);
`,
];

export function migrate(db: DatabaseSync): void {
  const at = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let version = at; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export interface TokenInfo {
  name: string;
  admin: boolean;
  resolver: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

/** A secret's row: its metadata and its sealed value. */
export interface SecretRow {
  name: string;
  description: string | null;
  version: number;
  sealed: Uint8Array;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export type AuditEntry = Omit<AuditEvent, "id">;

export const secretHash = (secret: string): string => createHash("sha256").update(secret).digest("hex");

type Row = Record<string, unknown>;

const secretOf = (row: Row): SecretRow => ({
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  version: row.version as number,
  sealed: row.sealed as Uint8Array,
  createdBy: row.created_by as string,
  createdAt: row.created_at as string,
  updatedBy: row.updated_by as string,
  updatedAt: row.updated_at as string,
});

const grantOf = (row: Row): Grant => ({
  id: row.id as string,
  secret: row.secret as string,
  variable: row.variable as string,
  target: row.target as string,
  createdBy: row.created_by as string,
  createdAt: row.created_at as string,
});

const list = (text: unknown) => (text === null || text === undefined ? null : (JSON.parse(text as string) as string[]));

const eventOf = (row: Row): AuditEvent => ({
  id: row.id as number,
  at: row.at as string,
  token: row.token as string,
  actor: (row.actor as string | null) ?? null,
  action: row.action as AuditAction,
  secret: (row.secret as string | null) ?? null,
  target: (row.target as string | null) ?? null,
  agent: (row.agent as string | null) ?? null,
  role: (row.role as string | null) ?? null,
  labels: list(row.labels),
  variables: list(row.variables),
});

/**
 * Secrets (sealed), grants, tokens (hashed) and the audit, in one SQLite
 * database. It never sees a value in the clear: sealing is `Keyring`'s.
 */
export class Store {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    migrate(db);
  }

  static open(path: string): Store {
    return new Store(new DatabaseSync(path));
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  /** Runs `fn` in one transaction. */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Copies the database to `file`, which must not exist yet, with `VACUUM INTO`. */
  backup(file: string): void {
    if (existsSync(file)) throw new Error(`${file} exists; backup writes a new file.`);
    this.db.prepare("VACUUM INTO ?").run(file);
  }

  meta(key: string): Uint8Array | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as Row | undefined;
    return row ? (row.value as Uint8Array) : null;
  }

  putMeta(key: string, value: Uint8Array): void {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  secret(name: string): SecretRow | null {
    const row = this.db.prepare("SELECT * FROM secrets WHERE name = ?").get(name) as Row | undefined;
    return row ? secretOf(row) : null;
  }

  secrets(): SecretRow[] {
    return (this.db.prepare("SELECT * FROM secrets ORDER BY name").all() as Row[]).map(secretOf);
  }

  putSecret(row: SecretRow): void {
    this.db
      .prepare(
        `INSERT INTO secrets (name, description, version, sealed, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET description = excluded.description, version = excluded.version, sealed = excluded.sealed, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .run(row.name, row.description, row.version, row.sealed, row.createdBy, row.createdAt, row.updatedBy, row.updatedAt);
  }

  /** Re-seals a value in place, as rekeying does. */
  resealSecret(name: string, sealed: Uint8Array): void {
    this.db.prepare("UPDATE secrets SET sealed = ? WHERE name = ?").run(sealed, name);
  }

  /** Deletes a secret and every grant of it. */
  deleteSecret(name: string): boolean {
    return this.transaction(() => {
      this.db.prepare("DELETE FROM grants WHERE secret = ?").run(name);
      return this.db.prepare("DELETE FROM secrets WHERE name = ?").run(name).changes > 0;
    });
  }

  putGrant(grant: Omit<Grant, "id">): Grant {
    const made = { id: randomUUID(), ...grant };
    try {
      this.db.prepare("INSERT INTO grants (id, secret, variable, target, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(made.id, made.secret, made.variable, made.target, made.createdBy, made.createdAt);
    } catch (err) {
      if (/UNIQUE/.test((err as Error).message)) throw new RequestError(`${grant.target} already has a grant that sets ${grant.variable}: revoke it first.`, 409);
      throw err;
    }
    return made;
  }

  grant(id: string): Grant | null {
    const row = this.db.prepare("SELECT * FROM grants WHERE id = ?").get(id) as Row | undefined;
    return row ? grantOf(row) : null;
  }

  /** Grants, by secret and target when given, oldest first. */
  grants(filter: { secret?: string; target?: string } = {}): Grant[] {
    const where: string[] = [];
    const args: string[] = [];
    if (filter.secret !== undefined) where.push("secret = ?"), args.push(filter.secret);
    if (filter.target !== undefined) where.push("target = ?"), args.push(filter.target);
    const sql = `SELECT * FROM grants ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at, id`;
    return (this.db.prepare(sql).all(...args) as Row[]).map(grantOf);
  }

  /** Grants whose target is one of `targets`. */
  grantsFor(targets: string[]): Grant[] {
    if (!targets.length) return [];
    return (this.db.prepare(`SELECT * FROM grants WHERE target IN (${targets.map(() => "?").join(", ")}) ORDER BY created_at, id`).all(...targets) as Row[]).map(grantOf);
  }

  deleteGrant(id: string): Grant | null {
    const row = this.db.prepare("DELETE FROM grants WHERE id = ? RETURNING *").get(id) as Row | undefined;
    return row ? grantOf(row) : null;
  }

  audit(entry: AuditEntry): void {
    this.db
      .prepare("INSERT INTO audit (at, token, actor, action, secret, target, agent, role, labels, variables) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        entry.at,
        entry.token,
        entry.actor,
        entry.action,
        entry.secret,
        entry.target,
        entry.agent,
        entry.role,
        entry.labels && JSON.stringify(entry.labels),
        entry.variables && JSON.stringify(entry.variables),
      );
  }

  /** Audit events, newest first, a page at a time; `nextToken` is the last id given. */
  events(filter: { agent?: string; action?: string; maxResults: number; nextToken?: string }): { events: AuditEvent[]; nextToken: string | null } {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.agent !== undefined) where.push("agent = ?"), args.push(filter.agent);
    if (filter.action !== undefined) where.push("action = ?"), args.push(filter.action);
    if (filter.nextToken !== undefined) {
      if (!/^\d+$/.test(filter.nextToken)) throw new RequestError("nextToken: not one this service gave.");
      where.push("id < ?"), args.push(Number(filter.nextToken));
    }
    const sql = `SELECT * FROM audit ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`;
    const rows = (this.db.prepare(sql).all(...args, filter.maxResults + 1) as Row[]).map(eventOf);
    const events = rows.slice(0, filter.maxResults);
    return { events, nextToken: rows.length > filter.maxResults ? String(events.at(-1)!.id) : null };
  }

  putToken(name: string, secret: string, rights: { admin: boolean; resolver: boolean }, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO tokens (name, hash, admin, resolver, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET hash = excluded.hash, admin = excluded.admin, resolver = excluded.resolver, created_at = excluded.created_at, last_used_at = NULL`,
      )
      .run(name, secretHash(secret), rights.admin ? 1 : 0, rights.resolver ? 1 : 0, at.toISOString());
  }

  /** The token whose secret this is, marked used now. */
  tokenFor(secret: string, at: Date): TokenInfo | null {
    const row = this.db.prepare("UPDATE tokens SET last_used_at = ? WHERE hash = ? RETURNING *").get(at.toISOString(), secretHash(secret)) as Row | undefined;
    return row ? tokenOf(row) : null;
  }

  tokens(): TokenInfo[] {
    return (this.db.prepare("SELECT * FROM tokens ORDER BY name").all() as Row[]).map(tokenOf);
  }

  revokeToken(name: string): boolean {
    return this.db.prepare("DELETE FROM tokens WHERE name = ?").run(name).changes > 0;
  }
}

const tokenOf = (row: Row): TokenInfo => ({
  name: row.name as string,
  admin: row.admin === 1,
  resolver: row.resolver === 1,
  createdAt: row.created_at as string,
  lastUsedAt: (row.last_used_at as string | null) ?? null,
});
