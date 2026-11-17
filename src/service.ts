import { CHECK_CONTEXT, CHECK_TEXT, contextOf, KeyError, open, seal } from "./crypto.ts";
import { hintOf, RequestError, winners, type Grant, type Secret, type Session } from "./domain.ts";
import type { AuditEntry, SecretRow, Store } from "./store.ts";

/** Who asked: the token's name, and the `x-actor` it sent. */
export interface Who {
  token: string;
  actor: string | null;
}

const by = (who: Who) => who.actor ?? who.token;

const NONE = { secret: null, target: null, agent: null, role: null, labels: null, variables: null } as const;

/**
 * The secrets, sealed under one master key, their grants, and resolving
 * them for a session. The only place a value is in the clear.
 */
export class Keyring {
  readonly store: Store;
  private key: Buffer;
  private readonly now: () => Date;

  /** Opens the store under `key`; refuses a key other than the one its values are sealed under. */
  constructor(store: Store, key: Buffer, now: () => Date = () => new Date()) {
    this.store = store;
    this.key = key;
    this.now = now;
    const check = store.meta("key-check");
    if (!check) store.putMeta("key-check", seal(key, CHECK_TEXT, CHECK_CONTEXT));
    else {
      try {
        open(key, check, CHECK_CONTEXT);
      } catch {
        throw new KeyError("KEYRING_MASTER_KEY is not the key this database's secrets are sealed under. Start with the key it was made with, or the one `keyring rekey` last moved it to.");
      }
    }
  }

  private shown(row: SecretRow): Secret {
    const { sealed, ...meta } = row;
    return { ...meta, hint: hintOf(this.value(row)) };
  }

  private value(row: SecretRow): string {
    return open(this.key, row.sealed, contextOf(row.name, row.version));
  }

  private audit(entry: Partial<AuditEntry> & Pick<AuditEntry, "action">, who: Who): void {
    this.store.audit({ ...NONE, ...entry, at: this.now().toISOString(), token: who.token, actor: who.actor });
  }

  /** Sets a secret's value as its next version; its description too, when given, else it keeps the one it had. */
  put(name: string, input: { value: string; description?: string | null }, who: Who): { secret: Secret; created: boolean } {
    return this.store.transaction(() => {
      const held = this.store.secret(name);
      const at = this.now().toISOString();
      const version = (held?.version ?? 0) + 1;
      const row: SecretRow = {
        name,
        description: input.description === undefined ? (held?.description ?? null) : input.description,
        version,
        sealed: seal(this.key, input.value, contextOf(name, version)),
        createdBy: held?.createdBy ?? by(who),
        createdAt: held?.createdAt ?? at,
        updatedBy: by(who),
        updatedAt: at,
      };
      this.store.putSecret(row);
      this.audit({ action: "PutSecret", secret: name }, who);
      return { secret: this.shown(row), created: !held };
    });
  }

  list(): Secret[] {
    return this.store.secrets().map((row) => this.shown(row));
  }

  find(name: string): Secret {
    const row = this.store.secret(name);
    if (!row) throw new RequestError(`No secret is named ${name}.`, 404);
    return this.shown(row);
  }

  /** Deletes a secret and its grants; answers it as it was. */
  delete(name: string, who: Who): Secret {
    const secret = this.find(name);
    this.store.deleteSecret(name);
    this.audit({ action: "DeleteSecret", secret: name }, who);
    return secret;
  }

  grant(input: { secret: string; variable: string; target: string }, who: Who): Grant {
    if (!this.store.secret(input.secret)) throw new RequestError(`No secret is named ${input.secret}.`, 404);
    const grant = this.store.putGrant({ ...input, createdBy: by(who), createdAt: this.now().toISOString() });
    this.audit({ action: "CreateGrant", secret: grant.secret, target: grant.target, variables: [grant.variable] }, who);
    return grant;
  }

  revoke(id: string, who: Who): Grant {
    const grant = this.store.deleteGrant(id);
    if (!grant) throw new RequestError(`No grant has the id ${id}.`, 404);
    this.audit({ action: "DeleteGrant", secret: grant.secret, target: grant.target, variables: [grant.variable] }, who);
    return grant;
  }

  /**
   * The environment a session gets: each granted variable, set from its most
   * specific grant. Audited with the variables' names, never their values.
   */
  resolve(session: Session, who: Who): Record<string, string> {
    const labels = [...new Set(session.labels ?? [])];
    const targets = ["all", `agent:${session.agent}`, ...(session.role ? [`role:${session.role}`] : []), ...labels.map((label) => `label:${label}`)];
    const chosen = winners(this.store.grantsFor(targets), { ...session, labels });
    const variables: Record<string, string> = {};
    for (const [variable, grant] of chosen) {
      const row = this.store.secret(grant.secret);
      if (row) variables[variable] = this.value(row);
    }
    this.audit({ action: "ResolveSecrets", agent: session.agent, role: session.role ?? null, labels, variables: Object.keys(variables) }, who);
    return variables;
  }

  /** Re-seals every value under `next`, in one transaction, and opens with it from now on; answers how many. */
  rekey(next: Buffer): number {
    const count = this.store.transaction(() => {
      const rows = this.store.secrets();
      for (const row of rows) this.store.resealSecret(row.name, seal(next, this.value(row), contextOf(row.name, row.version)));
      this.store.putMeta("key-check", seal(next, CHECK_TEXT, CHECK_CONTEXT));
      return rows.length;
    });
    this.key = next;
    return count;
  }
}
