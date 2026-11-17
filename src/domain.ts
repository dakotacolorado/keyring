/** keyring's types and pure rules: names, targets, and which grant wins. */

/** A secret's name: letters, digits, `_`, `.` and `-`, such as `CLAUDE_CODE_OAUTH_TOKEN-main`. */
export const SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** An environment variable a grant sets. */
export const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** An agent's, role's or host label's name. */
export const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
/** Whom a grant is for: everyone, or one agent, role or agency host label. */
export const TARGET = /^(all|(agent|role|label):[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127})$/;
/** A token's name. */
export const TOKEN_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export const DESCRIPTION_MAX = 500;
/** A value's most characters: enough for a credentials file. */
export const VALUE_MAX = 65_536;
export const LABELS_MAX = 50;
/** A value at least this long shows its last 4 characters in a listing; a shorter one shows none. */
export const HINT_MIN = 16;

/** A secret as it is listed: everything but its value. */
export interface Secret {
  name: string;
  description: string | null;
  version: number;
  /** The value's last 4 characters, after `…`, when it is at least HINT_MIN long. */
  hint: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface Grant {
  id: string;
  secret: string;
  variable: string;
  target: string;
  createdBy: string;
  createdAt: string;
}

/** Who a session is, as agency starts it. */
export interface Session {
  agent: string;
  role?: string | null;
  labels?: string[];
}

export type AuditAction = "ResolveSecrets" | "PutSecret" | "DeleteSecret" | "CreateGrant" | "DeleteGrant";

/** One thing done, never with a value. */
export interface AuditEvent {
  id: number;
  at: string;
  /** The name of the token that called. */
  token: string;
  /** The `x-actor` header it sent, if any. */
  actor: string | null;
  action: AuditAction;
  /** The secret written, or the grant's. */
  secret: string | null;
  /** The grant's target. */
  target: string | null;
  /** Whom a resolve was for. */
  agent: string | null;
  role: string | null;
  labels: string[] | null;
  /** The variables a resolve set, or the grant's one. */
  variables: string[] | null;
}

/** A request the caller must change: answered with its status and message. */
export class RequestError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  constructor(message: string, status: 400 | 403 | 404 | 409 = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * How specific a target is, most first: an agent's own, then its role's, then
 * one of its host's labels, then everyone's. Null when it is not for `session`.
 */
export function rankFor(target: string, session: Session): number | null {
  if (target === "all") return 3;
  const [kind, name] = [target.slice(0, target.indexOf(":")), target.slice(target.indexOf(":") + 1)];
  if (kind === "agent") return name === session.agent ? 0 : null;
  if (kind === "role") return session.role != null && name === session.role ? 1 : null;
  if (kind === "label") return (session.labels ?? []).includes(name) ? 2 : null;
  return null;
}

/**
 * The grant that sets each variable for `session`: the most specific, and of
 * two as specific (two of its labels), the one made first.
 */
export function winners(grants: Grant[], session: Session): Map<string, Grant> {
  const best = new Map<string, { grant: Grant; rank: number }>();
  for (const grant of grants) {
    const rank = rankFor(grant.target, session);
    if (rank === null) continue;
    const held = best.get(grant.variable);
    const earlier = held && (grant.createdAt < held.grant.createdAt || (grant.createdAt === held.grant.createdAt && grant.id < held.grant.id));
    if (!held || rank < held.rank || (rank === held.rank && earlier)) best.set(grant.variable, { grant, rank });
  }
  return new Map([...best].sort(([a], [b]) => a.localeCompare(b)).map(([variable, { grant }]) => [variable, grant]));
}

export const hintOf = (value: string): string | null => (value.length >= HINT_MIN ? `…${value.slice(-4)}` : null);
