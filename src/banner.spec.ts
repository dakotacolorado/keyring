import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "./build.ts";
import { banner, MARK_ICON, MARK_PIXELS, MARK_SVG, OLIVE, SUMMARY, TAGLINE, WORDMARK } from "./banner.ts";

const info = { version: "1.2.3", url: "http://127.0.0.1:4830", publicUrl: "https://beta:8452", db: "/data/keyring.db", notes: [], color: false };

describe("banner", () => {
  it("carries the tagline and summary verbatim", () => {
    expect(TAGLINE).toBe("Every agent's keys on one ring, and only the ones it may use.");
    expect(SUMMARY).toBe("Keeps the platform's secrets encrypted, and hands each agent session the ones granted to it.");
  });

  it("is a ring holding two keys, in olive on light and dark", () => {
    expect(OLIVE).toEqual({ light: "#6b6b1f", dark: "#c9c96a" });
    for (const svg of [MARK_SVG, MARK_ICON]) {
      expect(svg).toContain('<circle cx="6" cy="8" r="4.5"/>');
      // Two shafts, each with two teeth.
      expect(svg.match(/M10\.5 \d+H23/g)).toHaveLength(2);
      expect(svg.match(/V\d+\.5/g)).toHaveLength(4);
    }
    expect(MARK_ICON).toContain("svg{--ink:#6b6b1f}");
    expect(MARK_ICON).toContain("@media (prefers-color-scheme:dark){svg{--ink:#c9c96a}}");
  });

  it("sets the mark beside the letters, a row of text for each two of pixels", () => {
    expect(MARK_PIXELS).toHaveLength(12);
    expect(new Set(MARK_PIXELS.map((row) => row.length))).toEqual(new Set([16]));
    expect(MARK_PIXELS[0]).not.toContain("#");
    expect(MARK_PIXELS.at(-1)).not.toContain("#");
    const lines = WORDMARK.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatch(/^██╗  ██╗███████╗/);
    expect(lines[1]).toMatch(/  ▄▀ {4}▀▄{9}$/);
  });

  it("says what keyring is and where its API and MCP are, at the public address", () => {
    expect(banner(info).split("\n")).toEqual([
      "",
      ...WORDMARK.split("\n"),
      "v1.2.3",
      "",
      TAGLINE,
      SUMMARY,
      "",
      "  ▸ API       https://beta:8452/api/secrets   docs https://beta:8452/docs/api",
      "  ▸ MCP       https://beta:8452/mcp           docs https://beta:8452/docs/mcp",
      "",
      "  listening on http://127.0.0.1:4830, secrets in /data/keyring.db",
      "  Ctrl+C to stop.",
      "",
    ]);
  });

  it("is painted olive only when color is on", () => {
    expect(banner(info)).not.toContain("\x1b");
    expect(banner({ ...info, color: true })).toContain("\x1b[38;5;100m");
  });

  it("opens the README as keyring prints it, up to where its parts are", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme.startsWith(`# keyring\n\n**${TAGLINE}**\n\n`)).toBe(true);
    const printed = banner({ ...info, publicUrl: "https://keyring.example.com", version: PACKAGE_VERSION });
    const opening = printed.slice(0, printed.indexOf("\n\n", printed.indexOf("▸ MCP"))).replace(/^\n+/, "");
    expect(readme).toContain(`\`\`\`\n${opening}\n\`\`\``);
    expect(readme).not.toMatch(/https?:\/\/(127\.0\.0\.1|localhost)/);
  });
});
