import { getOpenApiMetadata } from "@asteasolutions/zod-to-openapi";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "@hono/zod-openapi";
import { TAGLINE } from "./banner.ts";
import * as routes from "./schema.ts";

export const INSTRUCTIONS = `keyring: ${TAGLINE} It keeps the platform's secrets (Claude logins, GitHub and AWS credentials, service tokens) sealed under one master key, and agency sets each session's environment from the grants made here as it starts the session.

- list_secrets shows each secret's name, description, version and at most its last 4 characters. No tool ever answers a value.
- put_secret makes a secret or gives it a new value; delete_secret removes it and its grants.
- grant gives a secret to a target as an environment variable: all, role:<name>, agent:<name> or label:<agency host label>. Of two grants for one variable, the most specific wins: agent, then role, then label, then all. list_grants and revoke (by the grant's id) go with it. These three need an admin token.
- list_audit shows who resolved which variables for which agent, and every write, newest first, without values.
- Every tool takes the token this server was connected with.`;

/** The address the MCP docs give, a placeholder; served, the address they were reached at replaces it. */
export const DOCS_URL = "https://keyring.example.com";

/** Sends one API request as the MCP request's caller, with a JSON body when given. */
export type Call = (method: string, path: string, body?: unknown) => Promise<Response>;

const query = (params: Record<string, string | number | undefined>) => {
  const set = Object.entries(params).flatMap(([key, value]): [string, string][] => (value === undefined ? [] : [[key, String(value)]]));
  return set.length ? `?${new URLSearchParams(set)}` : "";
};

/**
 * `shape` with each field's OpenAPI description as its own: `.openapi()`
 * keeps a description where zod's JSON Schema, which MCP lists, cannot see it.
 */
const described = <Shape extends z.ZodRawShape>(shape: Shape): Shape =>
  Object.fromEntries(
    Object.entries(shape).map(([name, core]) => {
      const field = core as z.ZodType;
      const text = field.description ?? getOpenApiMetadata(field)?.description;
      return [name, text ? field.describe(text) : field];
    }),
  ) as unknown as Shape;

type Answer = { content: { type: "text"; text: string }[]; isError?: true };

/** A JSON answer as the tool's text; an API error is the tool's error, in the API's words. */
async function answer(res: Response): Promise<Answer> {
  const text = JSON.stringify(await res.json(), null, 2);
  return { content: [{ type: "text", text }], ...(res.status >= 400 && { isError: true as const }) };
}

const NameShape = { name: routes.SecretName };

/**
 * The MCP server for one request: the API's metadata and grant operations,
 * each a tool made as one API request with the caller's own `authorization`,
 * so it is refused and recorded exactly as that request would be. It has no
 * tool for `ResolveSecrets`, so no answer of it holds a value.
 */
export function mcpServer(version: string, call: Call): McpServer {
  const server = new McpServer({ name: "keyring", version }, { instructions: INSTRUCTIONS });

  const tool = <Shape extends z.ZodRawShape>(
    name: string,
    title: string,
    description: string,
    inputSchema: Shape,
    run: (input: z.infer<z.ZodObject<Shape>>) => Promise<Answer>,
    hints: { readOnly?: boolean; destructive?: boolean; idempotent?: boolean } = {},
  ) => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: described(inputSchema),
        annotations: { readOnlyHint: hints.readOnly ?? false, destructiveHint: hints.destructive ?? false, idempotentHint: hints.idempotent ?? false },
      },
      // The SDK types a tool's input by its own zod; these are the API's schemas, which it validates the same.
      run as never,
    );
  };

  tool("list_secrets", "List secrets", routes.listSecretsRoute.description!, {}, async () => answer(await call("GET", "/api/secrets")), { readOnly: true });

  tool(
    "put_secret",
    "Put a secret",
    routes.putSecretRoute.description!,
    { ...NameShape, ...routes.PutSecretSchema.shape },
    async ({ name, ...body }) => answer(await call("PUT", `/api/secrets/${encodeURIComponent(name)}`, body)),
  );

  tool("delete_secret", "Delete a secret", routes.deleteSecretRoute.description!, NameShape, async ({ name }) => answer(await call("DELETE", `/api/secrets/${encodeURIComponent(name)}`)), {
    destructive: true,
    idempotent: true,
  });

  tool("list_grants", "List grants", routes.listGrantsRoute.description!, routes.GrantsQuery.shape, async (input) => answer(await call("GET", `/api/grants${query(input)}`)), { readOnly: true });

  tool("grant", "Grant a secret", routes.createGrantRoute.description!, routes.CreateGrantSchema.shape, async (input) => answer(await call("POST", "/api/grants", input)));

  tool("revoke", "Revoke a grant", routes.deleteGrantRoute.description!, { id: routes.GrantSchema.shape.id }, async ({ id }) => answer(await call("DELETE", `/api/grants/${id}`)), {
    destructive: true,
    idempotent: true,
  });

  tool("list_audit", "List audit events", routes.listAuditRoute.description!, routes.AuditQuery.shape, async (input) => answer(await call("GET", `/api/audit${query(input)}`)), { readOnly: true });

  return server;
}
