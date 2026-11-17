# keyring

**Every agent's keys on one ring, and only the ones it may use.**

```
██╗  ██╗███████╗██╗   ██╗██████╗ ██╗███╗   ██╗ ██████╗     ▄▄▄▄
██║ ██╔╝██╔════╝╚██╗ ██╔╝██╔══██╗██║████╗  ██║██╔════╝   ▄▀    ▀▄▄▄▄▄▄▄▄▄
█████╔╝ █████╗   ╚████╔╝ ██████╔╝██║██╔██╗ ██║██║  ███╗  █      █    ▀ ▀▀
██╔═██╗ ██╔══╝    ╚██╔╝  ██╔══██╗██║██║╚██╗██║██║   ██║  █      █▄▄▄▄▄▄▄▄
██║  ██╗███████╗   ██║   ██║  ██║██║██║ ╚████║╚██████╔╝  ▀▄    ▄▀    ▀ ▀▀
╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝ ╚═════╝     ▀▀▀▀
v0.1.0

Every agent's keys on one ring, and only the ones it may use.
Keeps the platform's secrets encrypted, and hands each agent session the ones granted to it.

  ▸ API       https://keyring.example.com/api/secrets   docs https://keyring.example.com/docs/api
  ▸ MCP       https://keyring.example.com/mcp           docs https://keyring.example.com/docs/mcp
```

keyring keeps secrets (logins, tokens, credentials files) sealed under one
master key. You grant each secret, as an environment variable, to all
sessions, to a role, to one agent, or to the hosts carrying a label. When a
session starts, the service that starts it asks keyring for that session's
variables, so no host keeps a copy.

## Run it

Node 24 or later. To try it, with the admin token `dev` and an all-zero
master key:

```sh
npm install
npm run dev
```

For real:

```sh
export KEYRING_MASTER_KEY=$(openssl rand -hex 32)   # keep it safe: without it nothing opens
keyring token create person --admin                # manages secrets and grants
keyring token create agency --resolver             # resolves sessions' variables
keyring serve
```

Each token is printed once.

## Configure it

| Option | Environment | Default | What it does |
| --- | --- | --- | --- |
| `--host` | `KEYRING_HOST` | `127.0.0.1` | Address to listen on. |
| `--port` | `KEYRING_PORT` | `4830` | Port to listen on. |
| `--db` | `KEYRING_DB` | `~/.local/share/keyring/keyring.db` | The SQLite database. |
| `--public-url` | `KEYRING_PUBLIC_URL` | where it listens | The address the banner gives. |
| | `KEYRING_MASTER_KEY` | none; required | 32 bytes in hex. Every value is sealed under it. |
| | `KEYRING_ADMIN_TOKEN` | none | One more token, named `admin`: an admin token that cannot resolve. |
| | `KEYRING_NEW_MASTER_KEY` | none | The key `keyring rekey` moves to. |

`keyring --help` lists the commands.

## Use it

Open the server's address in a browser for its Secrets page: sign in with
`https://<address>/#signin=<KEYRING_ADMIN_TOKEN>`. From it you add, replace
and delete secrets and add and revoke grants. It shows a secret's name,
version and last 4 characters, never its value, and its writes are audited
as `person`. Only `KEYRING_ADMIN_TOKEN` signs in.

The API reference is served at `/docs/api` (and is
[docs/API.md](docs/API.md), from [openapi.json](openapi.json)); the MCP
server's at `/docs/mcp` ([docs/MCP.md](docs/MCP.md), from
[mcp.json](mcp.json)).

Put a secret, then grant it to every implementer:

```sh
curl -X PUT -H "Authorization: Bearer $KEYRING_TOKEN" -H 'content-type: application/json' \
  -d '{"value": "…", "description": "GitHub token for implementers"}' \
  "$KEYRING_URL/api/secrets/GH_TOKEN-implementers"
curl -X POST -H "Authorization: Bearer $KEYRING_TOKEN" -H 'content-type: application/json' \
  -d '{"secret": "GH_TOKEN-implementers", "variable": "GH_TOKEN", "target": "role:implementer"}' \
  "$KEYRING_URL/api/grants"
```

A resolver token then gets a session's variables:

```sh
curl -X POST -H "Authorization: Bearer $RESOLVER_TOKEN" -H 'content-type: application/json' \
  -d '{"agent": "implementer-1", "role": "implementer", "labels": ["gpu"]}' \
  "$KEYRING_URL/api/resolve"
# {"variables": {"GH_TOKEN": "…"}}
```

The person and agents manage secrets and grants through the MCP server at
`/mcp`, with a token in its config:

```json
{ "mcpServers": { "keyring": { "type": "http", "url": "https://keyring.example.com/mcp", "headers": { "Authorization": "Bearer <token>" } } } }
```

## How it works

- **Values.** Each value is sealed with AES-256-GCM under
  `KEYRING_MASTER_KEY`, with a random nonce, bound to its secret's name and
  version. The database holds only ciphertext. A wrong key stops the server
  at start, saying so.
- **Nothing answers a value but resolve.** Listing a secret gives its name,
  description, version and at most its last 4 characters. No MCP tool
  answers a value.
- **Tokens.** Any token puts, lists and deletes secrets and reads the audit.
  `--admin` tokens also manage grants. Only `--resolver` tokens resolve.
- **Grants.** A target is `all`, `role:<name>`, `agent:<name>` or
  `label:<host label>`. A target has at most one grant per variable. When
  several grants for one variable match a session, the most specific wins:
  agent, then role, then label, then all. Between two labels, the older
  grant wins.
- **Audit.** Every resolve, and every put, delete, grant and revoke, is kept
  at `GET /api/audit`: which token, its `x-actor`, which agent, and which
  variables. Never a value.
- **Backup.** `keyring backup <file>` writes a copy of the database to a new
  file while the server runs. It holds only ciphertext, so it is safe to keep
  off the host. Keep the master key apart from it.
- **Rekey.** Stop the server, run `keyring rekey` with the old key as
  `KEYRING_MASTER_KEY` and the new one as `KEYRING_NEW_MASTER_KEY`, then start
  it with the new key. Every value is sealed again in one transaction.

## Check a running keyring

```sh
KEYRING_URL=https://keyring.example.com KEYRING_TOKEN=<token made --admin --resolver> npm run integ
```

It puts a test secret, grants it to a test agent, resolves it, reads the
audit and the MCP server, and deletes all it made. It never prints the value.

## Develop it

```sh
npm install
npm run typecheck
npm test
npm run build
npm run spec     # regenerates openapi.json, mcp.json and docs/
```

## License

MIT
