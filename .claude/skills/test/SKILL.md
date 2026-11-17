---
name: test
description: How to run keyring's checks. Use before submitting a change to keyring, and when reviewing one.
---

# Testing keyring

## The checks

An author runs these at the PR's head before submitting it, and a reviewer at
the commit reviewed. Each must exit 0. In a clean clone, with Node 24 and npm,
and the session's `*_URL`/`*_TOKEN` pairs unset so nothing reaches a deployed
service:

```sh
env -u HONED_URL -u HONED_TOKEN -u WAYPOINT_URL -u WAYPOINT_TOKEN -u JOBBER_URL -u JOBBER_TOKEN -u AGENCY_URL -u AGENCY_TOKEN -u PEEK_URL -u PEEK_TOKEN -u KEYRING_URL -u KEYRING_TOKEN -u KEYRING_MASTER_KEY -u KEYRING_ADMIN_TOKEN npm ci
env -u HONED_URL -u HONED_TOKEN -u WAYPOINT_URL -u WAYPOINT_TOKEN -u JOBBER_URL -u JOBBER_TOKEN -u AGENCY_URL -u AGENCY_TOKEN -u PEEK_URL -u PEEK_TOKEN -u KEYRING_URL -u KEYRING_TOKEN -u KEYRING_MASTER_KEY -u KEYRING_ADMIN_TOKEN npm run typecheck
env -u HONED_URL -u HONED_TOKEN -u WAYPOINT_URL -u WAYPOINT_TOKEN -u JOBBER_URL -u JOBBER_TOKEN -u AGENCY_URL -u AGENCY_TOKEN -u PEEK_URL -u PEEK_TOKEN -u KEYRING_URL -u KEYRING_TOKEN -u KEYRING_MASTER_KEY -u KEYRING_ADMIN_TOKEN npm test
env -u HONED_URL -u HONED_TOKEN -u WAYPOINT_URL -u WAYPOINT_TOKEN -u JOBBER_URL -u JOBBER_TOKEN -u AGENCY_URL -u AGENCY_TOKEN -u PEEK_URL -u PEEK_TOKEN -u KEYRING_URL -u KEYRING_TOKEN -u KEYRING_MASTER_KEY -u KEYRING_ADMIN_TOKEN npm run build
```

Run each on its own and read its exit status (`echo $?`). Never pipe one into
`tail` or `head`: the pipe reports their status, so a failure reads as a pass.

`npm test` needs no network and no service: the database runs on SQLite in
memory or in a temporary file, and `src/cli.spec.ts` starts the server on
ports the OS picks. It also fails if `openapi.json`, `mcp.json` or the docs
drift from the code: regenerate them with `npm run spec`.

Installing points git at `.githooks/`, whose pre-commit runs `npm run spec`.

## End to end

`npm run integ` checks a running instance, given its address and a token it
takes made `--admin --resolver`, and deletes all it made. Against a local
one, on a port none holds, with a scratch folder, key and token:

```sh
mkdir -p scratch && openssl rand -hex 32 > scratch/key
KEYRING_MASTER_KEY=$(cat scratch/key) node src/cli.ts token create integ --admin --resolver --db scratch/keyring.db > scratch/token
KEYRING_MASTER_KEY=$(cat scratch/key) KEYRING_DB=scratch/keyring.db node src/cli.ts serve --port 0 > scratch/log 2>&1 &
echo $! > scratch/pid   # wait until scratch/log says "listening on", and read the port there
KEYRING_URL=http://127.0.0.1:<port> KEYRING_TOKEN=$(cat scratch/token) npm run integ; echo $?
kill $(cat scratch/pid); rm -rf scratch
```

To try it by hand, `npm run dev -- --port <a free port>` (admin token `dev`,
an all-zero key), and stop it by the PID you started.
