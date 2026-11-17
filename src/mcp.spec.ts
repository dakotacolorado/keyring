import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mcpDocument, renderMcp, renderMcpHtml } from "./mcp-doc.ts";
import { MCP_DOC, MCP_FILE, MCP_PAGE } from "./spec.ts";
import { ADMIN, AGENT, RESOLVER, setup } from "./testing.ts";

const VALUE = "ghp_canary0123456789abcdefghijklmnopqrst";

function mcp() {
  const t = setup();
  const rpc = (method: string, params: unknown, token = AGENT) =>
    t.fetch("/mcp", { method: "POST", headers: { ...t.bearer(token), accept: "application/json, text/event-stream" }, json: { jsonrpc: "2.0", id: 1, method, params } });
  /** A tool's answer: its text, its JSON, and whether it is an error. */
  const use = async <T = Record<string, unknown>>(name: string, args: unknown, token = AGENT) => {
    const res = await rpc("tools/call", { name, arguments: args }, token);
    expect(res.status).toBe(200);
    const { result } = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
    const text = result.content[0]!.text;
    return { isError: result.isError === true, text, json: (text.startsWith("MCP error") ? { text } : JSON.parse(text)) as T };
  };
  return { ...t, rpc, use };
}

describe("the MCP server", () => {
  it("lists the metadata, grant and audit tools, and none that resolves", async () => {
    const { tools } = await mcpDocument();
    expect(tools.map((tool) => tool.name)).toEqual(["list_secrets", "put_secret", "delete_secret", "list_grants", "grant", "revoke", "list_audit"]);
    for (const tool of tools) for (const [name, field] of Object.entries(tool.inputSchema.properties ?? {})) expect(field.description, `${tool.name}.${name}`).toBeTruthy();
  });

  it("never answers a value, from any tool, even to a resolver or admin token", async () => {
    const t = mcp();
    const answers: string[] = [];
    const use = async (name: string, args: unknown, token = AGENT) => {
      const got = await t.use(name, args, token);
      answers.push(got.text);
      return got;
    };
    expect((await use("put_secret", { name: "GH_TOKEN-main", value: VALUE, description: "gh login" })).json).toMatchObject({ name: "GH_TOKEN-main", version: 1, hint: "…qrst" });
    const grant = await use("grant", { secret: "GH_TOKEN-main", variable: "GH_TOKEN", target: "all" }, ADMIN);
    expect(grant.isError).toBe(false);
    await t.resolve({ agent: "a" });
    for (const token of [AGENT, RESOLVER, ADMIN]) {
      await use("list_secrets", {}, token);
      await use("list_audit", {}, token);
    }
    expect((await use("list_grants", {}, ADMIN)).json).toMatchObject({ grants: [{ variable: "GH_TOKEN" }] });
    expect((await use("revoke", { id: (grant.json as { id: string }).id }, ADMIN)).isError).toBe(false);
    expect((await use("delete_secret", { name: "GH_TOKEN-main" })).isError).toBe(false);
    expect(answers.length).toBe(11);
    for (const text of answers) expect(text).not.toContain("canary");
  });

  it("refuses grants to a plain token, as the API does", async () => {
    const t = mcp();
    const { isError, json } = await t.use("list_grants", {});
    expect(isError).toBe(true);
    expect(json).toMatchObject({ code: "AccessDeniedException" });
  });

  it("refuses a caller without a token", async () => {
    const t = mcp();
    expect((await t.rpc("tools/list", {}, "wrong")).status).toBe(401);
  });
});

describe("mcp.json, docs/MCP.md and docs/mcp.html", () => {
  it("match what the server lists", async () => {
    const served = await mcpDocument();
    expect(JSON.parse(readFileSync(MCP_FILE, "utf8"))).toEqual(served);
    expect(readFileSync(MCP_DOC, "utf8")).toBe(renderMcp(served));
    expect(readFileSync(MCP_PAGE, "utf8")).toBe(renderMcpHtml(served));
  });

  it("open by saying what keyring is for and who uses the server", () => {
    expect(readFileSync(MCP_DOC, "utf8").split("\n")[4]).toMatch(/^keyring keeps the platform's secrets .* for the person and agents/);
  });
});
