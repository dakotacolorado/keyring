// keyring's page: its secrets and their grants, at /. A shell holding no data: it signs the browser in,
// then fetches what it shows. Every element is made with `h`, which sets text, never HTML. A value is
// typed into a password field, sent once and cleared; nothing here reads one back, only the hint keyring gives.
import { LETTERS, MARK_PIXELS, SUMMARY, TAGLINE } from "./banner.js";

const $ = (id) => document.getElementById(id);

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) if (value !== null && value !== undefined && value !== false) node.setAttribute(name, value === true ? "" : String(value));
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

function pixelMark() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  for (const [name, value] of Object.entries({ viewBox: `0 0 ${MARK_PIXELS[0].length} ${MARK_PIXELS.length}`, "shape-rendering": "crispEdges", fill: "currentColor", "aria-hidden": "true" })) svg.setAttribute(name, value);
  MARK_PIXELS.forEach((row, y) =>
    [...row].forEach((pixel, x) => {
      if (pixel !== "#") return;
      const rect = document.createElementNS(NS, "rect");
      for (const [name, value] of Object.entries({ x, y, width: 1, height: 1 })) rect.setAttribute(name, String(value));
      svg.append(rect);
    }),
  );
  return svg;
}

function landing() {
  $("landing").replaceChildren(
    h("a", { class: "wordmark", href: "/", "aria-label": "keyring" }, h("pre", { "aria-hidden": "true" }, LETTERS), pixelMark()),
    h("p", { class: "tagline" }, TAGLINE),
    h("p", { class: "summary" }, SUMMARY),
  );
  $("landing").hidden = false;
}

function say(text) {
  $("status").textContent = text;
  $("status").hidden = !text;
}

/** Every write says it is the person's and that the page made it: the audit records the first, the server demands the second. */
const WRITE = { "x-keyring": "1", "x-actor": "person" };

class Refused extends Error {}

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { ...(method !== "GET" && WRITE), ...(body !== undefined && { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401) throw new SignedOut();
  if (!res.ok) throw new Refused((await res.json().catch(() => null))?.message ?? `keyring answered ${res.status}.`);
  return res.json();
}
class SignedOut extends Error {}

async function signIn(token) {
  const res = await fetch("/api/session", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  return res.ok;
}

function showSignIn(message) {
  $("secrets").hidden = true;
  $("signout").hidden = true;
  landing();
  say(message);
  $("signin").hidden = false;
  $("token").focus();
}

const when = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
const KINDS = [["all", "everyone"], ["role", "a role"], ["agent", "an agent"], ["label", "a host label"]];

const auditWords = (e) => {
  const who = e.actor ?? e.token;
  if (e.action === "ResolveSecrets") return `${who} resolved ${(e.variables ?? []).join(", ") || "no variables"} for ${e.agent ?? "an agent"}${e.role ? ` (${e.role})` : ""}`;
  return `${who} ${e.action}${e.secret ? ` ${e.secret}` : ""}${e.target ? ` → ${e.target}` : ""}`;
};

const said = () => $("said");
function tell(text, refused = false) {
  said().textContent = text;
  said().classList.toggle("refused", refused);
}

/** Does a write, redraws, and says what happened, or why it was refused. */
async function run(what, action) {
  try {
    await action();
    await draw();
    tell(what);
  } catch (e) {
    if (e instanceof SignedOut) return showSignIn("Signed out: sign in again.");
    tell(e instanceof Error ? e.message : "No answer.", true);
  }
}

/** Sends a password field's value once and empties the field at once. */
function send(field, what, put) {
  const value = field.value;
  field.value = "";
  return run(what, () => put(value));
}

function valueField(extra = {}) {
  return h("input", { name: "value", type: "password", autocomplete: "new-password", required: true, placeholder: "value", "aria-label": "New value", ...extra });
}

function grantBox(secret, mine) {
  const variable = h("input", { name: "variable", required: true, placeholder: "VARIABLE", autocomplete: "off", autocapitalize: "off", "aria-label": "Variable" });
  const kind = h("select", { name: "kind", "aria-label": "For" }, ...KINDS.map(([v, label]) => h("option", { value: v }, label)));
  const who = h("input", { name: "who", placeholder: "name", autocomplete: "off", autocapitalize: "off", hidden: true, "aria-label": "Name" });
  kind.addEventListener("change", () => {
    who.hidden = kind.value === "all";
    who.required = kind.value !== "all";
  });
  const form = h("form", { class: "grant", "data-secret": secret }, variable, kind, who, h("button", { type: "submit" }, "Grant"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const target = kind.value === "all" ? "all" : `${kind.value}:${who.value.trim()}`;
    const name = variable.value.trim();
    void run(`Granted ${secret} as ${name} to ${target}.`, () => api("POST", "/api/grants", { secret, variable: name, target }));
  });
  const list = mine.map((g) =>
    h("li", { "data-grant": g.id }, h("code", {}, g.variable), " ← ", g.target, h("button", { type: "button", onclick: null }, "Revoke")),
  );
  list.forEach((li, i) => li.querySelector("button").addEventListener("click", () => void run(`Revoked ${mine[i].variable} for ${mine[i].target}.`, () => api("DELETE", `/api/grants/${mine[i].id}`))));
  return h("div", {}, h("ul", { class: "grants" }, ...list), form);
}

function secretItem(s, grants) {
  const mine = grants.filter((g) => g.secret === s.name);
  const field = valueField();
  const replace = h("form", { class: "secret-actions", "data-secret": s.name }, field, h("button", { type: "submit" }, "Replace"));
  replace.addEventListener("submit", (e) => {
    e.preventDefault();
    void send(field, `Replaced ${s.name}.`, (value) => api("PUT", `/api/secrets/${encodeURIComponent(s.name)}`, { value }));
  });
  const remove = h("button", { type: "button", class: "danger" }, "Delete");
  remove.addEventListener("click", () => {
    if (confirm(`Delete ${s.name} and its ${mine.length} grant${mine.length === 1 ? "" : "s"}? This cannot be undone.`)) void run(`Deleted ${s.name}.`, () => api("DELETE", `/api/secrets/${encodeURIComponent(s.name)}`));
  });
  replace.append(remove);
  return h("li", { "data-secret": s.name },
    h("div", { class: "name" }, s.name),
    h("dl", { class: "facts" },
      h("dt", {}, "For"), h("dd", {}, s.description ?? "–"),
      h("dt", {}, "Version"), h("dd", {}, `v${s.version}`),
      h("dt", {}, "Ends"), h("dd", {}, s.hint ?? "–"),
      h("dt", {}, "Updated"), h("dd", {}, `${when(s.updatedAt)} by ${s.updatedBy}`),
    ),
    grantBox(s.name, mine),
    replace,
  );
}

async function draw() {
  const [{ secrets }, { grants }, audit] = await Promise.all([api("GET", "/api/secrets"), api("GET", "/api/grants"), api("GET", "/api/audit?maxResults=25").catch((e) => (e instanceof SignedOut ? Promise.reject(e) : { events: [] }))]);
  $("list").replaceChildren(...(secrets.length ? secrets.map((s) => secretItem(s, grants)) : [h("li", {}, "No secrets yet.")]));
  $("audit").replaceChildren(...(audit.events.length ? audit.events.map((e) => h("li", {}, `${when(e.at)} · ${auditWords(e)}`)) : [h("li", {}, "Nothing yet.")]));
  landing();
  $("landing").classList.add("small");
  $("signin").hidden = true;
  $("signout").hidden = false;
  $("secrets").hidden = false;
  say("");
}

async function start() {
  const given = /(?:^#|&)signin=([^&]+)/.exec(location.hash);
  let refused = false;
  if (given) {
    history.replaceState(null, "", location.pathname + location.search);
    refused = !(await signIn(decodeURIComponent(given[1])));
  }
  try {
    await draw();
  } catch (e) {
    if (e instanceof SignedOut) showSignIn(refused ? "That token was refused." : "Sign in to see the secrets.");
    else say(e instanceof Error ? e.message : "No answer.");
  }
}

$("signin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = $("token").value;
  $("token").value = "";
  if (await signIn(token)) {
    $("signin").hidden = true;
    say("Loading…");
    try { await draw(); } catch { showSignIn("Sign in to see the secrets."); }
  } else showSignIn("That token was refused.");
});

$("signout").addEventListener("click", async () => {
  await fetch("/api/session", { method: "DELETE", headers: WRITE }).catch(() => null);
  showSignIn("Signed out.");
});

$("addSecret").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("addName").value.trim();
  const description = $("addDescription").value.trim();
  $("addName").value = "";
  $("addDescription").value = "";
  void send($("addValue"), `Added ${name}.`, (value) => api("PUT", `/api/secrets/${encodeURIComponent(name)}`, { value, ...(description && { description }) }));
});

void start();
