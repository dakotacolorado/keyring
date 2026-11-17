import { describe, expect, it } from "vitest";
import { hintOf, rankFor, TARGET, winners, type Grant } from "./domain.ts";

let n = 0;
const grant = (variable: string, target: string, secret = target): Grant => ({ id: `g${String(n).padStart(3, "0")}`, secret, variable, target, createdBy: "t", createdAt: `2026-01-01T00:00:${String(n++).padStart(2, "0")}Z` });
const session = { agent: "implementer-1", role: "implementer", labels: ["gpu", "laptop"] };

describe("grant precedence", () => {
  it("ranks agent, then role, then label, then all, and matches only the session's", () => {
    expect(["agent:implementer-1", "role:implementer", "label:gpu", "all"].map((t) => rankFor(t, session))).toEqual([0, 1, 2, 3]);
    expect(["agent:other", "role:reviewer", "label:desktop"].map((t) => rankFor(t, session))).toEqual([null, null, null]);
    expect(rankFor("role:implementer", { agent: "a" })).toBeNull();
  });

  it("gives each variable its most specific grant, whatever order they were made in", () => {
    const grants = [grant("TOKEN", "all"), grant("TOKEN", "label:gpu"), grant("TOKEN", "role:implementer"), grant("TOKEN", "agent:implementer-1"), grant("OTHER", "all")];
    for (const order of [grants, [...grants].reverse()]) {
      expect(Object.fromEntries([...winners(order, session)].map(([v, g]) => [v, g.target]))).toEqual({ OTHER: "all", TOKEN: "agent:implementer-1" });
    }
    expect(winners(grants.slice(0, 3), session).get("TOKEN")!.target).toBe("role:implementer");
    expect(winners(grants.slice(0, 2), session).get("TOKEN")!.target).toBe("label:gpu");
    expect(winners(grants.slice(0, 3), { agent: "x" }).get("TOKEN")!.target).toBe("all");
  });

  it("of two labels' grants for one variable, keeps the older", () => {
    const older = grant("T", "label:laptop");
    const newer = grant("T", "label:gpu");
    expect(winners([newer, older], session).get("T")).toBe(older);
  });
});

describe("rules", () => {
  it("takes only the four kinds of target", () => {
    for (const t of ["all", "agent:implementer-3073d56b", "role:implementer", "label:rtx-4090"]) expect(t).toMatch(TARGET);
    for (const t of ["everyone", "host:x", "agent:", "role:a b", "label:"]) expect(t).not.toMatch(TARGET);
  });

  it("hints at most a long value's last 4 characters", () => {
    expect(hintOf("0123456789abcdefWXYZ")).toBe("…WXYZ");
    expect(hintOf("short-value")).toBeNull();
  });
});
