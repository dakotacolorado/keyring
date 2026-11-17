# keyring's MCP server

<!-- Generated from src/mcp.ts by `npm run spec`; do not edit. -->

keyring keeps the platform's secrets sealed under one master key, and hands each agent session the ones granted to it as environment variables. Its MCP server is for the person and agents managing them: put and delete secrets, grant them to agents, roles, host labels or all, and read the audit of what was resolved. No tool answers a value: only the API's `ResolveSecrets`, for resolver tokens, does. It is served at `/mcp` (streamable HTTP, stateless, answering JSON), under a token from `keyring token create <name>`; each tool is one API request made with it, so it is refused and answered as that request would be. A refusal comes back as the tool's error, in the API's words.

```json
{
  "mcpServers": {
    "keyring": {
      "type": "http",
      "url": "https://keyring.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <your token>"
      }
    }
  }
}
```

## Instructions

What the server tells an agent when it connects:

> keyring: Every agent's keys on one ring, and only the ones it may use. It keeps the platform's secrets (Claude logins, GitHub and AWS credentials, service tokens) sealed under one master key, and agency sets each session's environment from the grants made here as it starts the session.
>
> - list_secrets shows each secret's name, description, version and at most its last 4 characters. No tool ever answers a value.
> - put_secret makes a secret or gives it a new value; delete_secret removes it and its grants.
> - grant gives a secret to a target as an environment variable: all, role:<name>, agent:<name> or label:<agency host label>. Of two grants for one variable, the most specific wins: agent, then role, then label, then all. list_grants and revoke (by the grant's id) go with it. These three need an admin token.
> - list_audit shows who resolved which variables for which agent, and every write, newest first, without values.
> - Every tool takes the token this server was connected with.

## Tools

| Tool | Does | Reads only |
| --- | --- | --- |
| [`list_secrets`](#list_secrets) | List secrets | yes |
| [`put_secret`](#put_secret) | Put a secret |  |
| [`delete_secret`](#delete_secret) | Delete a secret |  |
| [`list_grants`](#list_grants) | List grants | yes |
| [`grant`](#grant) | Grant a secret |  |
| [`revoke`](#revoke) | Revoke a grant |  |
| [`list_audit`](#list_audit) | List audit events | yes |

### list_secrets

Every secret, by name, without its value.

No input.

### put_secret

Makes a secret, or gives it a new value as its next version. The value is sealed with AES-256-GCM under the master key before it is stored, and the answer holds none of it but `hint`.

| Input | Type | Required | |
| --- | --- | --- | --- |
| `name` | string | yes | The secret's name: letters, digits, `_`, `.` and `-`, at most 128. |
| `value` | string | yes | The value, at most 65,536 characters: a token, or a credentials file's text. Sealed before it is stored, and never answered but by `ResolveSecrets`. |
| `description` | string or null |  | What it is, and what it is for. Left out, it keeps the one it had; null clears it. |

### delete_secret

Deletes a secret, its value and every grant of it.

| Input | Type | Required | |
| --- | --- | --- | --- |
| `name` | string | yes | The secret's name: letters, digits, `_`, `.` and `-`, at most 128. |

### list_grants

Grants matching every filter given, oldest first. Admin tokens only.

| Input | Type | Required | |
| --- | --- | --- | --- |
| `secret` | string |  | Only the grants of this secret. |
| `target` | string |  | Only the grants for this target. |

### grant

Grants a secret to sessions matching `target`, as `variable`. One target sets one variable from one grant: revoke the old one to change it. Admin tokens only.

| Input | Type | Required | |
| --- | --- | --- | --- |
| `secret` | string | yes | The secret to set the variable to. |
| `variable` | string | yes | The environment variable it sets. |
| `target` | string | yes | Whom it is for: `all`, `agent:<name>`, `role:<name>` or `label:<agency host label>`. |

### revoke

Revokes a grant: sessions resolved after it no longer get its variable from it. Admin tokens only.

| Input | Type | Required | |
| --- | --- | --- | --- |
| `id` | string | yes | The grant's id. |

### list_audit

Every resolve and every write of a secret or grant, newest first, a page at a time: while `nextToken` is not null, pass it for the next page. No event holds a value.

| Input | Type | Required | |
| --- | --- | --- | --- |
| `agent` | string |  | Only resolves for this agent. |
| `action` | `ResolveSecrets`, `PutSecret`, `DeleteSecret`, `CreateGrant`, `DeleteGrant` |  | Only this operation. |
| `maxResults` | integer |  | The most to answer. Default: 100. |
| `nextToken` | string |  | The `nextToken` a page answered, for the page after it. |
