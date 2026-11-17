# keyring

Keeps the platform's secrets encrypted, and hands each agent session the ones
granted to it. A secret is a name, a description, a version and a value
sealed under the master key; a grant sets an environment variable to a
secret for a target (`all`, `role:`, `agent:`, `label:`); a resolve answers
a session's variables. Keep the model this simple: secrets, grants, tokens
and the audit, nothing of any one caller's domain. One Node 24 process
(`src/cli.ts`) serving HTTP, everything in one SQLite file (`src/store.ts`).

Keep it fact-dense: the code carries the facts. Prefer a mechanism to a
comment: a type, a test or a thrown error cannot rot. Comment only for a limit
a reader would otherwise violate, a deliberate choice that reads as a mistake,
or platform behaviour not visible in the source.

The repository is public: no hosts, addresses, tokens or deployment details
of any one setup in it.

## Contract

`src/schema.ts` is the source of `openapi.json`, its AWS-layout reference
(`docs/API.md`, by `src/api-doc.ts`) and Redoc's page of it
(`docs/index.html`, served at `/docs/api`). `src/mcp.ts` is the source of
`mcp.json`, `docs/MCP.md` and `docs/mcp.html`. The pre-commit hook
regenerates all of them (`npm run spec`); a test fails if any drifts.

Name an operation VerbNoun as AWS does, keep summaries to two or three
words, describe every field, and answer errors as `{code, message}` with the
status's exception name (`ERROR_CODES`): tests hold all of it.

## Rules a change must keep

- **Values are sealed before they are stored.** Only `Keyring`
  (`src/service.ts`) holds the key or a value in the clear; `Store` sees
  sealed bytes. Nothing logs a value, and no error message echoes one.
- **Only `ResolveSecrets` answers a value**, and only to a `--resolver`
  token. No other response schema has a value field, and the MCP server has
  no resolve tool: tests hold both.
- **Every resolve and write is audited, with names only.**
- **Secrets are hashes, too.** Tokens are stored as sha256.
- **The key is checked at start.** The database keeps a value sealed under
  the key (`meta.key-check`); a key that does not open it refuses to start.

## Where things are

- `src/domain.ts`: types and pure rules: names, targets, which grant wins (`winners`).
- `src/crypto.ts`: AES-256-GCM sealing and the key's format.
- `src/service.ts`: `Keyring`: put, list, delete, grant, revoke, resolve, rekey; the audit of each.
- `src/store.ts`: SQLite. A new shape is a new entry appended to `MIGRATIONS`, never an edit to one.
- `src/banner.ts`: the tagline, summary, block letters, the key-ring mark and its olive; the terminal banner and the favicon take them from here.
- `src/api.ts`: routes, auth and rights, `/mcp` (stateless, each tool one in-process API request with the caller's own headers).
- `src/integ.ts`: `npm run integ`, end to end against a running instance; not part of `npm test`.

## Tests

Colocated as `*.spec.ts`; test our rules, not the library's. `npm test` needs
no network: the database runs on SQLite in memory or in a temporary file
(`src/testing.ts`), and `src/cli.spec.ts` starts the server on ports the OS
picks. How to run the checks is the `test` skill
(`.claude/skills/test/SKILL.md`).
