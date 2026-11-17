# keyring API reference

API version 2026-11-17

Keeps the platform's secrets encrypted, and hands each agent session the ones granted to it. **The person** and **agents** put the platform's secrets here (a Claude login, a GitHub token, an AWS credentials file) and grant each to the sessions that need it, as an environment variable. **agency** resolves a session's variables as it starts it, so no host keeps a copy.

- **Secrets:** `PutSecret` seals a value with AES-256-GCM under the master key and keeps it as the secret's next version. `ListSecrets` and `GetSecret` answer metadata, with at most the value's last 4 characters; `DeleteSecret` removes it and its grants.
- **Grants:** `CreateGrant` sets `variable` to a secret for `all`, `role:<name>`, `agent:<name>` or `label:<host label>`. Admin tokens only.
- **Resolve:** `ResolveSecrets` answers `{variables}` for an agent, its role and its host's labels; the most specific grant of each variable wins. Resolver tokens only, and the only operation that answers a value.
- **Audit:** `ListAuditEvents` lists every resolve and write, with names but never values.

**Auth:** `Authorization: Bearer <token>` on everything but `GetHealth` and the docs. A token is made with `keyring token create <name>`; `--admin` lets it manage grants, `--resolver` lets it resolve. `KEYRING_ADMIN_TOKEN` is one more, named `admin`, an admin token that cannot resolve.

**Page:** `/` is keyring's own page, signed in by `#signin=<KEYRING_ADMIN_TOKEN>`: `CreateSession` turns the token into a cookie, which every call but `/mcp` then takes, a write by it needing `x-keyring: 1`. The page lists, puts and deletes secrets and grants, and never shows a value.

**Who:** a write's `createdBy` and `updatedBy` are the caller's `x-actor` header, when it gives one, else its token's name; the audit records both.

**Errors:** `{code, message}`, where `code` is an AWS-style exception name such as `ValidationException` or `AccessDeniedException`.

## Operations

- [CreateGrant](#creategrant): Create a grant
- [CreateSession](#createsession): Create session
- [DeleteGrant](#deletegrant): Delete a grant
- [DeleteSecret](#deletesecret): Delete a secret
- [DeleteSession](#deletesession): Delete session
- [GetHealth](#gethealth): Get health
- [GetSecret](#getsecret): Get a secret
- [ListAuditEvents](#listauditevents): List audit events
- [ListGrants](#listgrants): List grants
- [ListSecrets](#listsecrets): List secrets
- [PutSecret](#putsecret): Put a secret
- [ResolveSecrets](#resolvesecrets): Resolve secrets

## Data types

- [AuditEvent](#auditevent)
- [Error](#error)
- [Grant](#grant)
- [Health](#health)
- [Secret](#secret)
- [Session](#session)

---

## CreateGrant

Grants a secret to sessions matching `target`, as `variable`. One target sets one variable from one grant: revoke the old one to change it. Admin tokens only.

### Request syntax

```http
POST /api/grants HTTP/1.1
Authorization: Bearer token
Content-type: application/json

{
   "secret": "string",
   "variable": "string",
   "target": "string"
}
```

### Request body

**secret**  
The secret to set the variable to.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. Required: Yes.

**variable**  
The environment variable it sets.  
Type: String. Pattern: `^[A-Za-z_][A-Za-z0-9_]{0,127}$`. Required: Yes.

**target**  
Whom it is for: `all`, `agent:<name>`, `role:<name>` or `label:<agency host label>`.  
Type: String. Pattern: `^(all|(agent|role|label):[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127})$`. Required: Yes.

### Response syntax

```http
HTTP/1.1 201
Content-type: application/json

{
   "id": "string",
   "secret": "string",
   "variable": "string",
   "target": "string",
   "createdBy": "string",
   "createdAt": "string"
}
```

### Response elements

**id**  
The grant's id.  
Type: String.

**secret**  
The secret it sets the variable to.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`.

**variable**  
The environment variable it sets.  
Type: String. Pattern: `^[A-Za-z_][A-Za-z0-9_]{0,127}$`.

**target**  
Whom it is for: `all`, `agent:<name>`, `role:<name>` or `label:<agency host label>`.  
Type: String. Pattern: `^(all|(agent|role|label):[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127})$`.

**createdBy**  
Who made it.  
Type: String.

**createdAt**  
Made at (ISO 8601).  
Type: String.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

**AccessDeniedException**  
The token is not an admin token.  
HTTP status: 403

**ResourceNotFoundException**  
No secret has that name.  
HTTP status: 404

**ConflictException**  
The target already has a grant that sets this variable.  
HTTP status: 409

---

## CreateSession

Signs a browser in: sets the `keyring_session` cookie (HttpOnly, Secure, SameSite=Lax), which every call but `/mcp` then takes in place of the bearer token, for 90 days or until `KEYRING_ADMIN_TOKEN` changes. Only `KEYRING_ADMIN_TOKEN` signs in. A write signed in by the cookie alone must also send `x-keyring: 1`.

### Request syntax

```http
POST /api/session HTTP/1.1
Authorization: Bearer token
```

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "name": "admin",
   "expiresAt": "string"
}
```

### Response elements

**name**  
Whose session it is.  
Type: String. Valid values: `admin`.

**expiresAt**  
When it ends (ISO 8601).  
Type: String.

### Errors

**UnauthorizedException**  
The bearer token is missing, wrong or revoked.  
HTTP status: 401

**AccessDeniedException**  
The token is not `KEYRING_ADMIN_TOKEN`.  
HTTP status: 403

---

## DeleteGrant

Revokes a grant: sessions resolved after it no longer get its variable from it. Admin tokens only.

### Request syntax

```http
DELETE /api/grants/{id} HTTP/1.1
Authorization: Bearer token
```

### URI request parameters

**id**  
The grant's id.  
Type: String. Required: Yes.

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "id": "string",
   "secret": "string",
   "variable": "string",
   "target": "string",
   "createdBy": "string",
   "createdAt": "string"
}
```

### Response elements

**id**  
The grant's id.  
Type: String.

**secret**  
The secret it sets the variable to.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`.

**variable**  
The environment variable it sets.  
Type: String. Pattern: `^[A-Za-z_][A-Za-z0-9_]{0,127}$`.

**target**  
Whom it is for: `all`, `agent:<name>`, `role:<name>` or `label:<agency host label>`.  
Type: String. Pattern: `^(all|(agent|role|label):[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127})$`.

**createdBy**  
Who made it.  
Type: String.

**createdAt**  
Made at (ISO 8601).  
Type: String.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

**AccessDeniedException**  
The token is not an admin token.  
HTTP status: 403

**ResourceNotFoundException**  
No grant has that id.  
HTTP status: 404

---

## DeleteSecret

Deletes a secret, its value and every grant of it.

### Request syntax

```http
DELETE /api/secrets/{name} HTTP/1.1
Authorization: Bearer token
```

### URI request parameters

**name**  
The secret's name: letters, digits, `_`, `.` and `-`, at most 128.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. Required: Yes.

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "name": "string",
   "description": "string",
   "version": number,
   "hint": "string",
   "createdBy": "string",
   "createdAt": "string",
   "updatedBy": "string",
   "updatedAt": "string"
}
```

### Response elements

**name**  
The secret's name: letters, digits, `_`, `.` and `-`, at most 128.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`.

**description**  
What it is, and what it is for.  
Type: String. Length: 1 to 500. Nullable: Yes.

**version**  
How many times its value was put: 1 when made, one more each put.  
Type: Integer. Range: 1 to any.

**hint**  
Its value's last 4 characters, after `…`, when the value is at least 16 long; else null. Never more of it.  
Type: String. Nullable: Yes.

**createdBy**  
Who made it: the caller's `x-actor`, else its token's name.  
Type: String.

**createdAt**  
Made at (ISO 8601).  
Type: String.

**updatedBy**  
Who put its current value.  
Type: String.

**updatedAt**  
Its current value put at (ISO 8601).  
Type: String.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

**ResourceNotFoundException**  
No secret has that name.  
HTTP status: 404

---

## DeleteSession

Signs the browser out: clears the cookie.

### Request syntax

```http
DELETE /api/session HTTP/1.1
Authorization: Bearer token
```

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "ok": "true"
}
```

### Response elements

**ok**  
Always true.  
Type: Boolean.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

---

## GetHealth

Get health.

### Request syntax

```http
GET /health HTTP/1.1
```

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "ok": "true",
   "version": "string",
   "commit": "string"
}
```

### Response elements

**ok**  
Always true.  
Type: Boolean.

**version**  
Package version.  
Type: String.

**commit**  
Commit it was built from.  
Type: String.

---

## GetSecret

A secret's metadata, without its value.

### Request syntax

```http
GET /api/secrets/{name} HTTP/1.1
Authorization: Bearer token
```

### URI request parameters

**name**  
The secret's name: letters, digits, `_`, `.` and `-`, at most 128.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. Required: Yes.

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "name": "string",
   "description": "string",
   "version": number,
   "hint": "string",
   "createdBy": "string",
   "createdAt": "string",
   "updatedBy": "string",
   "updatedAt": "string"
}
```

### Response elements

**name**  
The secret's name: letters, digits, `_`, `.` and `-`, at most 128.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`.

**description**  
What it is, and what it is for.  
Type: String. Length: 1 to 500. Nullable: Yes.

**version**  
How many times its value was put: 1 when made, one more each put.  
Type: Integer. Range: 1 to any.

**hint**  
Its value's last 4 characters, after `…`, when the value is at least 16 long; else null. Never more of it.  
Type: String. Nullable: Yes.

**createdBy**  
Who made it: the caller's `x-actor`, else its token's name.  
Type: String.

**createdAt**  
Made at (ISO 8601).  
Type: String.

**updatedBy**  
Who put its current value.  
Type: String.

**updatedAt**  
Its current value put at (ISO 8601).  
Type: String.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

**ResourceNotFoundException**  
No secret has that name.  
HTTP status: 404

---

## ListAuditEvents

Every resolve and every write of a secret or grant, newest first, a page at a time: while `nextToken` is not null, pass it for the next page. No event holds a value.

### Request syntax

```http
GET /api/audit?agent=agent&action=action&maxResults=maxResults&nextToken=nextToken HTTP/1.1
Authorization: Bearer token
```

### Query parameters

**agent**  
Only resolves for this agent.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$`. Required: No.

**action**  
Only this operation.  
Type: String. Valid values: `ResolveSecrets` | `PutSecret` | `DeleteSecret` | `CreateGrant` | `DeleteGrant`. Required: No.

**maxResults**  
The most to answer. Default: 100.  
Type: Integer. Range: 1 to 500. Required: No.

**nextToken**  
The `nextToken` a page answered, for the page after it.  
Type: String. Length: 0 to 40. Required: No.

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "events": [ {
      "id": number,
      "at": "string",
      "token": "string",
      "actor": "string",
      "action": "ResolveSecrets | PutSecret | DeleteSecret | CreateGrant | DeleteGrant",
      "secret": "string",
      "target": "string",
      "agent": "string",
      "role": "string",
      "labels": [ "string" ],
      "variables": [ "string" ]
   } ],
   "nextToken": "string"
}
```

### Response elements

**events**  
This page's events, newest first.  
Type: Array of [AuditEvent](#auditevent) objects.

**nextToken**  
Pass it as `nextToken` for the next page; null on the last.  
Type: String. Nullable: Yes.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

---

## ListGrants

Grants matching every filter given, oldest first. Admin tokens only.

### Request syntax

```http
GET /api/grants?secret=secret&target=target HTTP/1.1
Authorization: Bearer token
```

### Query parameters

**secret**  
Only the grants of this secret.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. Required: No.

**target**  
Only the grants for this target.  
Type: String. Pattern: `^(all|(agent|role|label):[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127})$`. Required: No.

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "grants": [ {
      "id": "string",
      "secret": "string",
      "variable": "string",
      "target": "string",
      "createdBy": "string",
      "createdAt": "string"
   } ]
}
```

### Response elements

**grants**  
The grants, oldest first.  
Type: Array of [Grant](#grant) objects.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

**AccessDeniedException**  
The token is not an admin token.  
HTTP status: 403

---

## ListSecrets

Every secret, by name, without its value.

### Request syntax

```http
GET /api/secrets HTTP/1.1
Authorization: Bearer token
```

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "secrets": [ {
      "name": "string",
      "description": "string",
      "version": number,
      "hint": "string",
      "createdBy": "string",
      "createdAt": "string",
      "updatedBy": "string",
      "updatedAt": "string"
   } ]
}
```

### Response elements

**secrets**  
Every secret, by name.  
Type: Array of [Secret](#secret) objects.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

---

## PutSecret

Makes a secret, or gives it a new value as its next version. The value is sealed with AES-256-GCM under the master key before it is stored, and the answer holds none of it but `hint`.

### Request syntax

```http
PUT /api/secrets/{name} HTTP/1.1
Authorization: Bearer token
Content-type: application/json

{
   "value": "string",
   "description": "string"
}
```

### URI request parameters

**name**  
The secret's name: letters, digits, `_`, `.` and `-`, at most 128.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. Required: Yes.

### Request body

**value**  
The value, at most 65,536 characters: a token, or a credentials file's text. Sealed before it is stored, and never answered but by `ResolveSecrets`.  
Type: String. Length: 1 to 65536. Required: Yes.

**description**  
What it is, and what it is for. Left out, it keeps the one it had; null clears it.  
Type: String. Length: 1 to 500. Nullable: Yes. Required: No.

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "name": "string",
   "description": "string",
   "version": number,
   "hint": "string",
   "createdBy": "string",
   "createdAt": "string",
   "updatedBy": "string",
   "updatedAt": "string"
}
```

### Response elements

**name**  
The secret's name: letters, digits, `_`, `.` and `-`, at most 128.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`.

**description**  
What it is, and what it is for.  
Type: String. Length: 1 to 500. Nullable: Yes.

**version**  
How many times its value was put: 1 when made, one more each put.  
Type: Integer. Range: 1 to any.

**hint**  
Its value's last 4 characters, after `…`, when the value is at least 16 long; else null. Never more of it.  
Type: String. Nullable: Yes.

**createdBy**  
Who made it: the caller's `x-actor`, else its token's name.  
Type: String.

**createdAt**  
Made at (ISO 8601).  
Type: String.

**updatedBy**  
Who put its current value.  
Type: String.

**updatedAt**  
Its current value put at (ISO 8601).  
Type: String.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

---

## ResolveSecrets

The environment a session gets as it starts: each variable granted to its agent, its role, one of its host's labels, or all, set to its secret's current value. Of two grants for one variable, the more specific wins: agent, then role, then label, then all; of two labels' grants, the older. Recorded in the audit with the variables' names, never their values. Resolver tokens only (`keyring token create <name> --resolver`).

### Request syntax

```http
POST /api/resolve HTTP/1.1
Authorization: Bearer token
Content-type: application/json

{
   "agent": "string",
   "role": "string",
   "labels": [ "string" ]
}
```

### Request body

**agent**  
The agent's name, which `agent:<name>` grants match.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$`. Required: Yes.

**role**  
Its role, which `role:<name>` grants match.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$`. Nullable: Yes. Required: No.

**labels**  
Its host's agency labels, which `label:<label>` grants match.  
Type: Array of strings. At most 50 items. Required: No.

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "variables": { }
}
```

### Response elements

**variables**  
Each variable's value, by name.  
Type: Object.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

**AccessDeniedException**  
The token is not a resolver token.  
HTTP status: 403

---

# Data types

## AuditEvent

One write or resolve: who did it and to what. It never holds a value.

### Contents

**id**  
The event's id, larger for later ones.  
Type: Integer. Required: Yes.

**at**  
Done at (ISO 8601).  
Type: String. Required: Yes.

**token**  
The name of the token that did it.  
Type: String. Required: Yes.

**actor**  
The `x-actor` header it sent, if any.  
Type: String. Nullable: Yes. Required: Yes.

**action**  
The operation done.  
Type: String. Valid values: `ResolveSecrets` | `PutSecret` | `DeleteSecret` | `CreateGrant` | `DeleteGrant`. Required: Yes.

**secret**  
The secret put or deleted, or the grant's; null for a resolve.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. Nullable: Yes. Required: Yes.

**target**  
The grant's target; null but for a grant made or revoked.  
Type: String. Nullable: Yes. Required: Yes.

**agent**  
Whom a resolve was for; null for anything else.  
Type: String. Nullable: Yes. Required: Yes.

**role**  
The role a resolve was given.  
Type: String. Nullable: Yes. Required: Yes.

**labels**  
The host labels a resolve was given.  
Type: Array of strings. Nullable: Yes. Required: Yes.

**variables**  
The variables a resolve answered, or the grant's one: names only, never values.  
Type: Array of strings. Nullable: Yes. Required: Yes.

## Error

Every error's body.

### Contents

**code**  
Exception name.  
Type: String. Valid values: `ValidationException` | `UnauthorizedException` | `AccessDeniedException` | `ResourceNotFoundException` | `ConflictException` | `InternalServerException`. Required: Yes.

**message**  
What went wrong.  
Type: String. Required: Yes.

## Grant

That sessions matching `target` get `variable` set to `secret`'s value.

### Contents

**id**  
The grant's id.  
Type: String. Required: Yes.

**secret**  
The secret it sets the variable to.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. Required: Yes.

**variable**  
The environment variable it sets.  
Type: String. Pattern: `^[A-Za-z_][A-Za-z0-9_]{0,127}$`. Required: Yes.

**target**  
Whom it is for: `all`, `agent:<name>`, `role:<name>` or `label:<agency host label>`.  
Type: String. Pattern: `^(all|(agent|role|label):[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127})$`. Required: Yes.

**createdBy**  
Who made it.  
Type: String. Required: Yes.

**createdAt**  
Made at (ISO 8601).  
Type: String. Required: Yes.

## Health

### Contents

**ok**  
Always true.  
Type: Boolean. Required: Yes.

**version**  
Package version.  
Type: String. Required: Yes.

**commit**  
Commit it was built from.  
Type: String. Required: Yes.

## Secret

A secret, without its value: only `ResolveSecrets` answers a value.

### Contents

**name**  
The secret's name: letters, digits, `_`, `.` and `-`, at most 128.  
Type: String. Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. Required: Yes.

**description**  
What it is, and what it is for.  
Type: String. Length: 1 to 500. Nullable: Yes. Required: Yes.

**version**  
How many times its value was put: 1 when made, one more each put.  
Type: Integer. Range: 1 to any. Required: Yes.

**hint**  
Its value's last 4 characters, after `…`, when the value is at least 16 long; else null. Never more of it.  
Type: String. Nullable: Yes. Required: Yes.

**createdBy**  
Who made it: the caller's `x-actor`, else its token's name.  
Type: String. Required: Yes.

**createdAt**  
Made at (ISO 8601).  
Type: String. Required: Yes.

**updatedBy**  
Who put its current value.  
Type: String. Required: Yes.

**updatedAt**  
Its current value put at (ISO 8601).  
Type: String. Required: Yes.

## Session

A browser's sign-in.

### Contents

**name**  
Whose session it is.  
Type: String. Valid values: `admin`. Required: Yes.

**expiresAt**  
When it ends (ISO 8601).  
Type: String. Required: Yes.

