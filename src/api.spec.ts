import { describe, expect, it } from "vitest";
import { ADMIN, AGENT, RESOLVER, setup } from "./testing.ts";

const VALUE = "sk-ant-oat01-canary-value-0123456789";

describe("auth", () => {
  it("answers /health and the docs without a token, and nothing else", async () => {
    const t = setup();
    expect(await (await t.fetch("/health")).json()).toEqual({ ok: true, version: "0.1.0", commit: "abc123" });
    expect((await t.fetch("/docs/api")).status).toBe(200);
    expect((await t.fetch("/favicon.svg")).headers.get("content-type")).toContain("image/svg+xml");
    expect((await t.fetch("/api/secrets")).status).toBe(401);
    expect((await t.fetch("/api/secrets", { headers: t.bearer("wrong") })).status).toBe(401);
    expect((await t.fetch("/mcp", { method: "POST" })).status).toBe(401);
  });

  it("lets only admin tokens manage grants", async () => {
    const t = setup();
    await t.put("A", VALUE);
    const grant = { secret: "A", variable: "A", target: "all" };
    for (const token of [AGENT, RESOLVER]) {
      expect((await t.call("POST", "/api/grants", grant, token)).status).toBe(403);
      expect((await t.call("GET", "/api/grants", undefined, token)).body).toMatchObject({ code: "AccessDeniedException" });
    }
    const made = await t.call<{ id: string }>("POST", "/api/grants", grant, ADMIN);
    expect(made.status).toBe(201);
    expect((await t.call("DELETE", `/api/grants/${made.body.id}`, undefined, AGENT)).status).toBe(403);
    t.store.putToken("ops", "ops-secret", { admin: true, resolver: false }, new Date());
    expect((await t.call("DELETE", `/api/grants/${made.body.id}`, undefined, "ops-secret")).status).toBe(200);
  });

  it("refuses resolve to any token not made --resolver, the admin's too", async () => {
    const t = setup();
    for (const token of [AGENT, ADMIN]) {
      const { status, body } = await t.resolve({ agent: "a" }, token);
      expect(status).toBe(403);
      expect(body).toMatchObject({ code: "AccessDeniedException", message: expect.stringContaining("not a resolver token") });
    }
    expect((await t.resolve({ agent: "a" })).status).toBe(200);
    expect(t.store.events({ maxResults: 10 }).events.map((e) => e.token)).toEqual(["agency"]);
  });
});

describe("secrets", () => {
  it("puts, versions, gets, lists and deletes, never answering a value", async () => {
    const t = setup();
    const made = await t.fetch("/api/secrets/CLAUDE_CODE_OAUTH_TOKEN-main", { method: "PUT", headers: { ...t.bearer(), "x-actor": "person" }, json: { value: VALUE, description: "Claude login" } });
    expect(made.status).toBe(201);
    const again = await t.put("CLAUDE_CODE_OAUTH_TOKEN-main", `${VALUE}-v2`);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ name: "CLAUDE_CODE_OAUTH_TOKEN-main", version: 2, description: "Claude login", hint: "…9-v2", createdBy: "person", updatedBy: "agent" });
    await t.put("SHORT", "abc123");
    const answers = [
      await (await t.fetch("/api/secrets", { headers: t.bearer() })).text(),
      await (await t.fetch("/api/secrets/SHORT", { headers: t.bearer() })).text(),
      await (await t.fetch("/api/secrets/CLAUDE_CODE_OAUTH_TOKEN-main", { headers: t.bearer() })).text(),
      JSON.stringify(again.body),
    ];
    for (const text of answers) {
      expect(text).not.toContain("canary-value");
      expect(text).not.toContain("abc123");
      expect(text).not.toMatch(/"value"/);
    }
    expect(JSON.parse(answers[0]!).secrets.map((s: { name: string; hint: string | null }) => [s.name, s.hint])).toEqual([
      ["CLAUDE_CODE_OAUTH_TOKEN-main", "…9-v2"],
      ["SHORT", null],
    ]);
    const gone = await t.call("DELETE", "/api/secrets/SHORT");
    expect(gone.body).toMatchObject({ name: "SHORT" });
    expect((await t.call("GET", "/api/secrets/SHORT")).status).toBe(404);
  });

  it("refuses a bad name, an empty value or too long a one, without echoing it", async () => {
    const t = setup();
    expect((await t.put("has space", VALUE)).status).toBe(400);
    expect((await t.put("A", "")).status).toBe(400);
    const long = await t.put("A", `${VALUE}${"x".repeat(70_000)}`);
    expect(long.status).toBe(400);
    expect(JSON.stringify(long.body)).not.toContain("canary");
  });

  it("deletes a secret's grants with it", async () => {
    const t = setup();
    await t.put("A", VALUE);
    await t.grant("A", "A", "all");
    await t.call("DELETE", "/api/secrets/A");
    expect((await t.call<{ grants: unknown[] }>("GET", "/api/grants", undefined, ADMIN)).body.grants).toEqual([]);
    expect((await t.resolve({ agent: "a" })).body.variables).toEqual({});
  });
});

describe("grants and resolve", () => {
  it("resolve to environment variables, the most specific grant of each winning", async () => {
    const t = setup();
    for (const name of ["ALL", "LABEL", "ROLE", "AGENT", "AWS"]) await t.put(name, `value-of-${name}`);
    await t.grant("ALL", "GH_TOKEN", "all");
    await t.grant("LABEL", "GH_TOKEN", "label:gpu");
    await t.grant("ROLE", "GH_TOKEN", "role:implementer");
    await t.grant("AGENT", "GH_TOKEN", "agent:implementer-1");
    await t.grant("AWS", "AWS_CREDENTIALS", "label:laptop");
    const as = async (session: { agent: string; role?: string; labels?: string[] }) => (await t.resolve(session)).body.variables;
    expect(await as({ agent: "implementer-1", role: "implementer", labels: ["gpu", "laptop"] })).toEqual({ AWS_CREDENTIALS: "value-of-AWS", GH_TOKEN: "value-of-AGENT" });
    expect(await as({ agent: "implementer-2", role: "implementer", labels: ["gpu"] })).toEqual({ GH_TOKEN: "value-of-ROLE" });
    expect(await as({ agent: "reviewer-1", role: "reviewer", labels: ["gpu"] })).toEqual({ GH_TOKEN: "value-of-LABEL" });
    expect(await as({ agent: "reviewer-1", labels: ["laptop"] })).toEqual({ AWS_CREDENTIALS: "value-of-AWS", GH_TOKEN: "value-of-ALL" });
    // A new version is what the next session gets.
    await t.put("ALL", "value-of-ALL-v2");
    expect(await as({ agent: "x" })).toEqual({ GH_TOKEN: "value-of-ALL-v2" });
  });

  it("lists and filters grants, refuses a second for one target and variable, and a missing secret", async () => {
    const t = setup();
    await t.put("A", VALUE);
    await t.put("B", VALUE);
    const a = await t.grant("A", "TOKEN", "role:implementer");
    await t.grant("B", "OTHER", "all");
    expect((await t.grant("B", "TOKEN", "role:implementer")).status).toBe(409);
    expect((await t.grant("NOPE", "TOKEN", "all")).status).toBe(404);
    expect((await t.grant("A", "TOKEN", "everyone")).status).toBe(400);
    const list = await t.call<{ grants: { id: string }[] }>("GET", "/api/grants?target=role%3Aimplementer", undefined, ADMIN);
    expect(list.body.grants.map((g) => g.id)).toEqual([a.body.id]);
    expect(JSON.stringify((await t.call("GET", "/api/grants", undefined, ADMIN)).body)).not.toContain(VALUE);
    expect((await t.call("DELETE", `/api/grants/${a.body.id}`, undefined, ADMIN)).status).toBe(200);
    expect((await t.call("DELETE", `/api/grants/${a.body.id}`, undefined, ADMIN)).status).toBe(404);
  });
});

describe("the audit", () => {
  it("records every resolve and write, by whom and for whom, with variable names and never values", async () => {
    const t = setup();
    await t.put("A", VALUE);
    const g = await t.grant("A", "TOKEN", "agent:implementer-1");
    await t.fetch("/api/resolve", { method: "POST", headers: { ...t.bearer(RESOLVER), "x-actor": "agency-prod" }, json: { agent: "implementer-1", role: "implementer", labels: ["gpu"] } });
    await t.call("DELETE", `/api/grants/${g.body.id}`, undefined, ADMIN);
    await t.call("DELETE", "/api/secrets/A");
    const res = await t.fetch("/api/audit", { headers: t.bearer() });
    const text = await res.text();
    expect(text).not.toContain(VALUE);
    expect(text).not.toContain("canary");
    const { events } = JSON.parse(text) as { events: Record<string, unknown>[] };
    expect(events.map((e) => e.action)).toEqual(["DeleteSecret", "DeleteGrant", "ResolveSecrets", "CreateGrant", "PutSecret"]);
    expect(events[2]).toMatchObject({ token: "agency", actor: "agency-prod", agent: "implementer-1", role: "implementer", labels: ["gpu"], variables: ["TOKEN"] });
    expect(events[3]).toMatchObject({ token: "admin", secret: "A", target: "agent:implementer-1", variables: ["TOKEN"] });
    // The table holds no value either.
    expect(JSON.stringify(t.store.db.prepare("SELECT * FROM audit").all())).not.toContain("canary");
  });

  it("pages newest first, and filters by agent and action", async () => {
    const t = setup();
    for (const agent of ["a", "b", "a"]) await t.resolve({ agent });
    const page = await t.call<{ events: { id: number; agent: string }[]; nextToken: string }>("GET", "/api/audit?maxResults=2");
    expect(page.body.events.map((e) => e.agent)).toEqual(["a", "b"]);
    const next = await t.call<{ events: { agent: string }[]; nextToken: null }>("GET", `/api/audit?maxResults=2&nextToken=${page.body.nextToken}`);
    expect(next.body).toMatchObject({ events: [{ agent: "a" }], nextToken: null });
    expect((await t.call<{ events: unknown[] }>("GET", "/api/audit?agent=b")).body.events).toHaveLength(1);
    expect((await t.call<{ events: unknown[] }>("GET", "/api/audit?action=PutSecret")).body.events).toHaveLength(0);
    expect((await t.call("GET", "/api/audit?nextToken=zz")).status).toBe(400);
  });
});
