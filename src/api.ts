import { OpenAPIHono } from "@hono/zod-openapi";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { MARK_ICON, SUMMARY } from "./banner.ts";
import { KeyError } from "./crypto.ts";
import { RequestError } from "./domain.ts";
import { DOCS_URL, mcpServer, type Call } from "./mcp.ts";
import * as routes from "./schema.ts";
import { ERROR_CODES, type ErrorStatus } from "./schema.ts";
import type { Keyring, Who } from "./service.ts";

export const SPEC_PATH = "/openapi.json";

/** The API's version, dated as AWS dates theirs: changed only when the contract is. */
export const API_VERSION = "2026-11-17";

/** The API's overview, at the top of its reference. Markdown. */
export const OVERVIEW = `${SUMMARY} **The person** and **agents** put the platform's secrets here (a Claude login, a GitHub token, an AWS credentials file) and grant each to the sessions that need it, as an environment variable. **agency** resolves a session's variables as it starts it, so no host keeps a copy.

- **Secrets:** \`PutSecret\` seals a value with AES-256-GCM under the master key and keeps it as the secret's next version. \`ListSecrets\` and \`GetSecret\` answer metadata, with at most the value's last 4 characters; \`DeleteSecret\` removes it and its grants.
- **Grants:** \`CreateGrant\` sets \`variable\` to a secret for \`all\`, \`role:<name>\`, \`agent:<name>\` or \`label:<host label>\`. Admin tokens only.
- **Resolve:** \`ResolveSecrets\` answers \`{variables}\` for an agent, its role and its host's labels; the most specific grant of each variable wins. Resolver tokens only, and the only operation that answers a value.
- **Audit:** \`ListAuditEvents\` lists every resolve and write, with names but never values.

**Auth:** \`Authorization: Bearer <token>\` on everything but \`GetHealth\` and the docs. A token is made with \`keyring token create <name>\`; \`--admin\` lets it manage grants, \`--resolver\` lets it resolve. \`KEYRING_ADMIN_TOKEN\` is one more, named \`admin\`, an admin token that cannot resolve.

**Who:** a write's \`createdBy\` and \`updatedBy\` are the caller's \`x-actor\` header, when it gives one, else its token's name; the audit records both.

**Errors:** \`{code, message}\`, where \`code\` is an AWS-style exception name such as \`ValidationException\` or \`AccessDeniedException\`.`;

export interface About {
  /** `package.json`'s version. */
  version: string;
  /** The commit it was built from, `-dirty` when built with uncommitted changes. */
  commit: string;
}

export interface ApiOptions {
  /** A token named `admin`, an admin's that cannot resolve, beside those in the database. */
  adminToken: string | null;
}

/** Who a request is from, and what its token may do. */
export interface Caller {
  name: string;
  admin: boolean;
  resolver: boolean;
}

type Env = { Variables: { caller: Caller } };

const digest = (secret: string) => createHash("sha256").update(secret).digest();

export class KeyringApi {
  readonly hono: OpenAPIHono<Env>;

  private readonly keyring: Keyring;
  private readonly about: About;
  private readonly options: ApiOptions;

  constructor(keyring: Keyring, about: About, options: ApiOptions) {
    this.keyring = keyring;
    this.about = about;
    this.options = options;
    this.hono = new OpenAPIHono<Env>({
      defaultHook: (result, c) => (result.success ? undefined : fail(c, 400, issues(result.error))),
    });
    this.auth();
    this.routes();
    this.mcp();
    this.pages();
    this.spec();
  }

  get fetch() {
    return this.hono.fetch;
  }

  private caller(c: Context): Caller | null {
    const secret = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    if (!secret) return null;
    const admin = this.options.adminToken;
    if (admin && timingSafeEqual(digest(secret), digest(admin))) return { name: "admin", admin: true, resolver: false };
    const token = this.keyring.store.tokenFor(secret, new Date());
    return token && { name: token.name, admin: token.admin, resolver: token.resolver };
  }

  private auth(): void {
    const signedIn = async (c: Context<Env>, next: Next) => {
      const caller = this.caller(c);
      if (!caller) return fail(c, 401, "No bearer token, or it is wrong or revoked.");
      c.set("caller", caller);
      await next();
    };
    this.hono.use("/api/*", signedIn);
    this.hono.use("/mcp", signedIn);
    this.hono.use("/api/grants", only("admin"));
    this.hono.use("/api/grants/*", only("admin"));
    this.hono.use("/api/resolve", only("resolver"));
  }

  private routes(): void {
    const app = this.hono;
    const who = (c: Context<Env>): Who => {
      const actor = c.req.header("x-actor")?.trim();
      return { token: c.get("caller").name, actor: actor && actor.length <= 100 && !/[\u0000-\u001f]/.test(actor) ? actor : null };
    };

    app.openapi(routes.healthRoute, (c) => c.json({ ok: true as const, ...this.about }, 200));

    app.openapi(routes.putSecretRoute, (c) => {
      const { secret, created } = this.keyring.put(c.req.valid("param").name, c.req.valid("json"), who(c));
      return created ? c.json(secret, 201) : c.json(secret, 200);
    });
    app.openapi(routes.listSecretsRoute, (c) => c.json({ secrets: this.keyring.list() }, 200));
    app.openapi(routes.getSecretRoute, (c) => c.json(this.keyring.find(c.req.valid("param").name), 200));
    app.openapi(routes.deleteSecretRoute, (c) => c.json(this.keyring.delete(c.req.valid("param").name, who(c)), 200));

    app.openapi(routes.createGrantRoute, (c) => c.json(this.keyring.grant(c.req.valid("json"), who(c)), 201));
    app.openapi(routes.listGrantsRoute, (c) => c.json({ grants: this.keyring.store.grants(c.req.valid("query")) }, 200));
    app.openapi(routes.deleteGrantRoute, (c) => c.json(this.keyring.revoke(c.req.valid("param").id, who(c)), 200));

    app.openapi(routes.resolveRoute, (c) => c.json({ variables: this.keyring.resolve(c.req.valid("json"), who(c)) }, 200));

    app.openapi(routes.listAuditRoute, (c) => c.json(this.keyring.store.events(c.req.valid("query")), 200));

    // Hono throws HTTPException for a malformed body before any handler runs;
    // collapsing this to 500 would report a bad request as our failure.
    app.onError((err, c) => {
      if (err instanceof RequestError) return fail(c, err.status, err.message);
      if (err instanceof HTTPException) return fail(c, err.status in ERROR_CODES ? (err.status as ErrorStatus) : 400, err.message || "The request is malformed.");
      if (err instanceof KeyError) {
        console.error(`keyring: ${err.message}`);
        return fail(c, 500, `${err.message} Was the database rekeyed while this server ran? Restart it with the new key.`);
      }
      console.error("Unhandled error:", err);
      return fail(c, 500, "Something went wrong on our side.");
    });
  }

  /**
   * The MCP server, at `/mcp`, stateless: each request gets its own, whose
   * tools make their API requests in-process with the request's own
   * `authorization` and `x-actor`.
   */
  private mcp(): void {
    this.hono.all("/mcp", async (c) => {
      const forwarded = Object.fromEntries(
        ["authorization", "x-actor"].flatMap((name) => {
          const value = c.req.header(name);
          return value === undefined ? [] : [[name, value]];
        }),
      );
      const origin = new URL(c.req.url).origin;
      const call: Call = (method, path, body) =>
        Promise.resolve(
          this.hono.fetch(
            new Request(`${origin}${path}`, { method, headers: { ...forwarded, ...(body !== undefined && { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) }),
          ),
        );
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await mcpServer(this.about.version, call).connect(transport);
      return transport.handleRequest(c.req.raw);
    });
  }

  /** The API's and the MCP server's docs and the favicon, read at their first request: none needs a token, and none holds data. */
  private pages(): void {
    const files = new Map<string, string>();
    const file = (path: string) => {
      if (!files.has(path)) files.set(path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
      return files.get(path)!;
    };
    const page = (path: string, type: string) => (c: Context) => c.body(file(path), 200, { "content-type": `${type}; charset=utf-8` });
    this.hono.get("/", (c) => c.redirect("/docs/api"));
    this.hono.get("/favicon.svg", (c) => c.body(MARK_ICON, 200, { "content-type": "image/svg+xml; charset=utf-8" }));
    this.hono.get("/docs/api", page("docs/index.html", "text/html"));
    this.hono.get("/mcp.json", page("mcp.json", "application/json"));
    // The docs' example address is a placeholder; served, they give the address they were reached at.
    this.hono.get("/docs/mcp", (c) => c.body(file("docs/mcp.html").replaceAll(DOCS_URL, originOf(c) ?? DOCS_URL), 200, { "content-type": "text/html; charset=utf-8" }));
  }

  private spec(): void {
    this.hono.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
      type: "http",
      scheme: "bearer",
      description: "A named token from `keyring token create`, or `KEYRING_ADMIN_TOKEN`.",
    });
    this.hono.doc(SPEC_PATH, {
      openapi: "3.1.0",
      info: { version: API_VERSION, title: "keyring", description: OVERVIEW },
      tags: [
        { name: "Secrets", description: "Put, list and delete secrets, never answering a value." },
        { name: "Grants", description: "Which sessions get which secret, as which variable. Admin tokens only." },
        { name: "Resolve", description: "A session's variables, with their values. Resolver tokens only." },
        { name: "Audit", description: "What was resolved and written, without values." },
        { name: "Platform", description: "Health." },
      ],
    });
  }
}

/** Refuses a caller whose token lacks `right`. */
function only(right: "admin" | "resolver") {
  return async (c: Context<Env>, next: Next) => {
    if (!c.get("caller")[right]) return fail(c, 403, right === "admin" ? "The token is not an admin token." : "The token is not a resolver token: make one with keyring token create <name> --resolver.");
    await next();
  };
}

/** The origin a request was sent to, through a proxy too; only what an address can be, since it is reflected into answers. */
function originOf(c: Context): string | null {
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto") ?? url.protocol.slice(0, -1);
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
  return /^https?$/.test(proto) && /^[\w.-]+(:\d+)?$|^\[[\da-fA-F:.]+\](:\d+)?$/.test(host) ? `${proto}://${host}` : null;
}

/** An error answer as an AWS API gives one: `{code, message}`, the code named for the status. */
function fail(c: Context, status: ErrorStatus, message: string) {
  return c.json({ code: ERROR_CODES[status], message }, status);
}

function issues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message)).join("; ");
}
