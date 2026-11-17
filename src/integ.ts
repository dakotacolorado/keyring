/**
 * `npm run integ`: checks a running keyring end to end, given KEYRING_URL and
 * KEYRING_TOKEN, a token made `--admin --resolver`. It puts a test secret,
 * grants it to a test agent, resolves it, reads the audit and MCP, and
 * deletes all it made, also when a check fails. It never prints the value.
 * Exits non-zero on any failure.
 */
import { randomBytes } from "node:crypto";

const base = process.env.KEYRING_URL?.replace(/\/+$/, "");
const token = process.env.KEYRING_TOKEN;
if (!base || !token) {
  process.stderr.write("integ: set KEYRING_URL (the instance's address) and KEYRING_TOKEN (a token it takes, made with --admin --resolver)\n");
  process.exit(2);
}

// Each run has names of its own, so it touches nothing else.
const run = randomBytes(4).toString("hex");
const secret = `keyring-integ-${run}`;
const variable = `KEYRING_INTEG_${run.toUpperCase()}`;
const agent = `keyring-integ-${run}`;
const value = `integ-${randomBytes(24).toString("base64url")}`;
const auth = (bearer: string) => ({ authorization: `Bearer ${bearer}`, "x-actor": "keyring-integ", "content-type": "application/json" });
let made = false;
const grants: string[] = [];
let checks = 0;

function check(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(what);
  checks++;
  process.stdout.write(`ok ${checks} - ${what}\n`);
}

async function call<T>(method: string, path: string, status: number, what: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ json: T; text: string }> {
  const res = await fetch(`${base}${path}`, { method, headers: { ...auth(token!), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  // Never print a value: an unexpected answer is shown only when it holds none.
  const shown = text.includes(value) ? "(answer withheld: it holds the test value)" : text.slice(0, 300);
  check(res.status === status, `${what}: ${status}${res.status === status ? "" : ` (answered ${res.status}: ${shown})`}`);
  return { json: JSON.parse(text) as T, text };
}

async function tool(name: string, args: unknown): Promise<string> {
  const { json } = await call<{ result: { content: { text: string }[] } }>("POST", "/mcp", 200, `MCP ${name} answers`, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  return json.result.content[0]!.text;
}

async function main() {
  const health = await fetch(`${base}/health`).then((res) => res.json() as Promise<{ ok: boolean; commit: string }>);
  check(health.ok && health.commit, `health names commit ${health.commit}`);
  check((await fetch(`${base}/api/secrets`)).status === 401, "listing without a token is refused 401");

  const put = await call<{ version: number; hint: string }>("PUT", `/api/secrets/${secret}`, 201, `PUT ${secret}`, { value, description: "keyring integ: deleted when the run ends" });
  made = true;
  check(put.json.version === 1 && put.json.hint === `…${value.slice(-4)}` && !put.text.includes(value), "the put answers version 1 and the hint, not the value");
  const again = await call<{ version: number }>("PUT", `/api/secrets/${secret}`, 200, "a second put", { value });
  check(again.json.version === 2, "the second put is version 2");

  const list = await call<{ secrets: { name: string }[] }>("GET", "/api/secrets", 200, "ListSecrets");
  check(list.json.secrets.some((s) => s.name === secret) && !list.text.includes(value), "the list holds the secret and not its value");

  const grant = await call<{ id: string }>("POST", "/api/grants", 201, "CreateGrant", { secret, variable, target: `agent:${agent}` });
  grants.push(grant.json.id);
  await call("POST", "/api/grants", 409, "a second grant for the same target and variable is refused", { secret, variable, target: `agent:${agent}` });

  const resolved = await call<{ variables: Record<string, string> }>("POST", "/api/resolve", 200, "ResolveSecrets", { agent, role: "keyring-integ", labels: [] });
  check(resolved.json.variables[variable] === value, `the agent's grant resolves ${variable} to the value`);
  const other = await call<{ variables: Record<string, string> }>("POST", "/api/resolve", 200, "ResolveSecrets for another agent", { agent: `${agent}-other` });
  check(!(variable in other.json.variables), "another agent does not get it");
  const audit = await call<{ events: { action: string; agent: string; variables: string[] }[] }>("GET", `/api/audit?agent=${agent}`, 200, "ListAuditEvents");
  check(audit.json.events[0]?.action === "ResolveSecrets" && audit.json.events[0].variables.includes(variable), "the audit records the resolve and its variable");
  check(!audit.text.includes(value), "the audit holds no value");

  const mcp = [await tool("list_secrets", {}), await tool("list_grants", { secret }), await tool("list_audit", { maxResults: 20 })];
  check(mcp.every((text) => !text.includes(value)), "no MCP answer holds the value");
  check(mcp[1]!.includes(variable), "MCP list_grants lists the grant");
}

async function cleanUp() {
  for (const id of grants) await fetch(`${base}/api/grants/${id}`, { method: "DELETE", headers: auth(token!) });
  if (made) {
    const res = await fetch(`${base}/api/secrets/${secret}`, { method: "DELETE", headers: auth(token!) });
    process.stdout.write(`# deleted ${secret}: ${res.status}\n`);
  }
}

try {
  await main();
  await cleanUp();
  check((await fetch(`${base}/api/secrets/${secret}`, { headers: auth(token!) })).status === 404, "the test secret is gone");
  process.stdout.write(`# ${checks} checks passed\n`);
} catch (err) {
  process.stdout.write(`not ok - ${(err as Error).message}\n`);
  await cleanUp();
  process.exit(1);
}
