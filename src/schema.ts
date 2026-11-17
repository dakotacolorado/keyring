import { createRoute, z } from "@hono/zod-openapi";
import { DESCRIPTION_MAX, HINT_MIN, LABELS_MAX, SECRET_NAME, SUBJECT, TARGET, VALUE_MAX, VARIABLE } from "./domain.ts";

/** Validates every request and generates `openapi.json`, so neither can drift. */

export const SecretName = z.string().regex(SECRET_NAME).describe("The secret's name: letters, digits, `_`, `.` and `-`, at most 128.").openapi({ example: "CLAUDE_CODE_OAUTH_TOKEN-main" });
const Variable = z.string().regex(VARIABLE).describe("The environment variable it sets.").openapi({ example: "CLAUDE_CODE_OAUTH_TOKEN" });
const Target = z
  .string()
  .regex(TARGET)
  .describe("Whom it is for: `all`, `agent:<name>`, `role:<name>` or `label:<agency host label>`.")
  .openapi({ example: "role:implementer" });
const Description = z.string().trim().min(1).max(DESCRIPTION_MAX).describe("What it is, and what it is for.").openapi({ example: "The Claude login agents run under." });
const Subject = z.string().regex(SUBJECT);
const At = (what: string) => z.string().describe(`${what} (ISO 8601).`);

export const SecretSchema = z
  .object({
    name: SecretName,
    description: Description.nullable(),
    version: z.int().min(1).describe("How many times its value was put: 1 when made, one more each put."),
    hint: z.string().nullable().describe(`Its value's last 4 characters, after \`…\`, when the value is at least ${HINT_MIN} long; else null. Never more of it.`).openapi({ example: "…x9Qa" }),
    createdBy: z.string().describe("Who made it: the caller's `x-actor`, else its token's name."),
    createdAt: At("Made at"),
    updatedBy: z.string().describe("Who put its current value."),
    updatedAt: At("Its current value put at"),
  })
  .describe("A secret, without its value: only `ResolveSecrets` answers a value.")
  .openapi("Secret");

export const GrantSchema = z
  .object({
    id: z.uuid().describe("The grant's id."),
    secret: SecretName.describe("The secret it sets the variable to."),
    variable: Variable,
    target: Target,
    createdBy: z.string().describe("Who made it."),
    createdAt: At("Made at"),
  })
  .describe("That sessions matching `target` get `variable` set to `secret`'s value.")
  .openapi("Grant");

export const ACTIONS = ["ResolveSecrets", "PutSecret", "DeleteSecret", "CreateGrant", "DeleteGrant"] as const;

export const AuditEventSchema = z
  .object({
    id: z.int().describe("The event's id, larger for later ones."),
    at: At("Done at"),
    token: z.string().describe("The name of the token that did it."),
    actor: z.string().nullable().describe("The `x-actor` header it sent, if any."),
    action: z.enum(ACTIONS).describe("The operation done."),
    secret: SecretName.nullable().describe("The secret put or deleted, or the grant's; null for a resolve."),
    target: z.string().nullable().describe("The grant's target; null but for a grant made or revoked."),
    agent: z.string().nullable().describe("Whom a resolve was for; null for anything else."),
    role: z.string().nullable().describe("The role a resolve was given."),
    labels: z.array(z.string()).nullable().describe("The host labels a resolve was given."),
    variables: z.array(z.string()).nullable().describe("The variables a resolve answered, or the grant's one: names only, never values."),
  })
  .describe("One write or resolve: who did it and to what. It never holds a value.")
  .openapi("AuditEvent");

export const ERROR_CODES = {
  400: "ValidationException",
  401: "UnauthorizedException",
  403: "AccessDeniedException",
  404: "ResourceNotFoundException",
  409: "ConflictException",
  500: "InternalServerException",
} as const;

export type ErrorStatus = keyof typeof ERROR_CODES;

export const ErrorSchema = z
  .object({
    code: z.enum(Object.values(ERROR_CODES) as [string, ...string[]]).describe("Exception name."),
    message: z.string().describe("What went wrong."),
  })
  .describe("Every error's body.")
  .openapi("Error");

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

/** An error answer, described as `<code>: <cause>`, which the reference lists as AWS's do. */
const fails = (status: ErrorStatus, cause: string) => json(ErrorSchema, `${ERROR_CODES[status]}: ${cause}`);

const FAILS = {
  400: fails(400, "The request failed validation."),
  401: fails(401, "No bearer token, or it is wrong or revoked."),
};
const ADMIN_ONLY = { 403: fails(403, "The token is not an admin token.") };
const NO_SECRET = { 404: fails(404, "No secret has that name.") };
const security: Record<string, string[]>[] = [{ bearerAuth: [] }];
const secrets = { security, tags: ["Secrets"] };
const grants = { security, tags: ["Grants"] };

const NameParam = z.object({ name: SecretName.openapi({ param: { name: "name", in: "path" } }) });

export const PutSecretSchema = z
  .object({
    value: z.string().min(1).max(VALUE_MAX).describe(`The value, at most ${VALUE_MAX.toLocaleString("en")} characters: a token, or a credentials file's text. Sealed before it is stored, and never answered but by \`ResolveSecrets\`.`),
    description: Description.nullable().optional().describe("What it is, and what it is for. Left out, it keeps the one it had; null clears it."),
  })
  .openapi("PutSecretInput");

export const CreateGrantSchema = z
  .object({ secret: SecretName.describe("The secret to set the variable to."), variable: Variable, target: Target })
  .openapi("CreateGrantInput");

export const GrantsQuery = z.object({
  secret: SecretName.optional().describe("Only the grants of this secret."),
  target: Target.optional().describe("Only the grants for this target."),
});

export const ResolveSchema = z
  .object({
    agent: Subject.describe("The agent's name, which `agent:<name>` grants match.").openapi({ example: "implementer-3073d56b" }),
    role: Subject.nullable().optional().describe("Its role, which `role:<name>` grants match.").openapi({ example: "implementer" }),
    labels: z.array(Subject).max(LABELS_MAX).default([]).describe("Its host's agency labels, which `label:<label>` grants match.").openapi({ example: ["rtx-4090"] }),
  })
  .openapi("ResolveSecretsInput");

export const AuditQuery = z.object({
  agent: Subject.optional().describe("Only resolves for this agent."),
  action: z.enum(ACTIONS).optional().describe("Only this operation."),
  maxResults: z.coerce.number().int().min(1).max(500).default(100).describe("The most to answer. Default: 100."),
  nextToken: z.string().max(40).optional().describe("The `nextToken` a page answered, for the page after it."),
});

// --- routes -----------------------------------------------------------------

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  operationId: "GetHealth",
  tags: ["Platform"],
  summary: "Get health",
  responses: {
    200: json(
      z
        .object({
          ok: z.literal(true).describe("Always true."),
          version: z.string().describe("Package version."),
          commit: z.string().describe("Commit it was built from."),
        })
        .openapi("Health"),
      "Service is up.",
    ),
  },
});

export const putSecretRoute = createRoute({
  ...secrets,
  method: "put",
  path: "/api/secrets/{name}",
  operationId: "PutSecret",
  summary: "Put a secret",
  description: "Makes a secret, or gives it a new value as its next version. The value is sealed with AES-256-GCM under the master key before it is stored, and the answer holds none of it but `hint`.",
  request: { params: NameParam, body: json(PutSecretSchema, "Its value, and what it is.") },
  responses: { 200: json(SecretSchema, "Its new version."), 201: json(SecretSchema, "Made."), ...FAILS },
});

export const listSecretsRoute = createRoute({
  ...secrets,
  method: "get",
  path: "/api/secrets",
  operationId: "ListSecrets",
  summary: "List secrets",
  description: "Every secret, by name, without its value.",
  responses: { 200: json(z.object({ secrets: z.array(SecretSchema).describe("Every secret, by name.") }).openapi("ListSecretsResponse"), "The secrets."), ...FAILS },
});

export const getSecretRoute = createRoute({
  ...secrets,
  method: "get",
  path: "/api/secrets/{name}",
  operationId: "GetSecret",
  summary: "Get a secret",
  description: "A secret's metadata, without its value.",
  request: { params: NameParam },
  responses: { 200: json(SecretSchema, "The secret."), ...FAILS, ...NO_SECRET },
});

export const deleteSecretRoute = createRoute({
  ...secrets,
  method: "delete",
  path: "/api/secrets/{name}",
  operationId: "DeleteSecret",
  summary: "Delete a secret",
  description: "Deletes a secret, its value and every grant of it.",
  request: { params: NameParam },
  responses: { 200: json(SecretSchema, "The secret, as it was."), ...FAILS, ...NO_SECRET },
});

export const createGrantRoute = createRoute({
  ...grants,
  method: "post",
  path: "/api/grants",
  operationId: "CreateGrant",
  summary: "Create a grant",
  description: "Grants a secret to sessions matching `target`, as `variable`. One target sets one variable from one grant: revoke the old one to change it. Admin tokens only.",
  request: { body: json(CreateGrantSchema, "The grant.") },
  responses: {
    201: json(GrantSchema, "Made."),
    ...FAILS,
    ...ADMIN_ONLY,
    ...NO_SECRET,
    409: fails(409, "The target already has a grant that sets this variable."),
  },
});

export const listGrantsRoute = createRoute({
  ...grants,
  method: "get",
  path: "/api/grants",
  operationId: "ListGrants",
  summary: "List grants",
  description: "Grants matching every filter given, oldest first. Admin tokens only.",
  request: { query: GrantsQuery },
  responses: { 200: json(z.object({ grants: z.array(GrantSchema).describe("The grants, oldest first.") }).openapi("ListGrantsResponse"), "The grants."), ...FAILS, ...ADMIN_ONLY },
});

export const deleteGrantRoute = createRoute({
  ...grants,
  method: "delete",
  path: "/api/grants/{id}",
  operationId: "DeleteGrant",
  summary: "Delete a grant",
  description: "Revokes a grant: sessions resolved after it no longer get its variable from it. Admin tokens only.",
  request: { params: z.object({ id: z.uuid().describe("The grant's id.").openapi({ param: { name: "id", in: "path" } }) }) },
  responses: { 200: json(GrantSchema, "The grant, as it was."), ...FAILS, ...ADMIN_ONLY, 404: fails(404, "No grant has that id.") },
});

export const resolveRoute = createRoute({
  security,
  tags: ["Resolve"],
  method: "post",
  path: "/api/resolve",
  operationId: "ResolveSecrets",
  summary: "Resolve secrets",
  description:
    "The environment a session gets as it starts: each variable granted to its agent, its role, one of its host's labels, or all, set to its secret's current value. Of two grants for one variable, the more specific wins: agent, then role, then label, then all; of two labels' grants, the older. Recorded in the audit with the variables' names, never their values. Resolver tokens only (`keyring token create <name> --resolver`).",
  request: { body: json(ResolveSchema, "Whom the session is for.") },
  responses: {
    200: json(
      z
        .object({ variables: z.record(z.string(), z.string()).describe("Each variable's value, by name.").openapi({ example: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-…" } }) })
        .openapi("ResolveSecretsResponse"),
      "The session's variables.",
    ),
    ...FAILS,
    403: fails(403, "The token is not a resolver token."),
  },
});

export const listAuditRoute = createRoute({
  security,
  tags: ["Audit"],
  method: "get",
  path: "/api/audit",
  operationId: "ListAuditEvents",
  summary: "List audit events",
  description: "Every resolve and every write of a secret or grant, newest first, a page at a time: while `nextToken` is not null, pass it for the next page. No event holds a value.",
  request: { query: AuditQuery },
  responses: {
    200: json(
      z
        .object({
          events: z.array(AuditEventSchema).describe("This page's events, newest first."),
          nextToken: z.string().nullable().describe("Pass it as `nextToken` for the next page; null on the last."),
        })
        .openapi("ListAuditEventsResponse"),
      "A page of events.",
    ),
    ...FAILS,
  },
});
