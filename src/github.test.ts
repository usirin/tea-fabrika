import { describe, expect, it } from "vitest";
import { parseIssueRef, rawIssueFrom, splitEnriched } from "./github.ts";

/** A body as fabrika's triage leaves it: its rewrite on top, the report as filed folded under it. */
const enriched = [
  "## In plain words",
  "",
  "`replay` should let a pure machine leave `ctx` out, as `run` does.",
  "",
  "### Acceptance criteria",
  "",
  "- [ ] `replay(m, { msgs })` compiles for a machine with no ctx.",
  "",
  "---",
  "",
  "<!-- fabrika:enriched issue=558 mode=rewrite -->",
  "<details>",
  "<summary>Original report (verbatim)</summary>",
  "",
  "## Summary",
  "`run` lets a pure machine leave `ctx` out, but `replay` still makes the caller pass one.",
  "",
  "---",
  "<sub>Filed by an agent · session `abc` · 2026-10-04T05:36:14Z</sub>",
  "",
  "</details>",
  "",
].join("\n");

describe("an issue from GitHub", () => {
  it("is named owner/repo#number", () => {
    expect(parseIssueRef("kamp-us/demlik#558")).toEqual({ repo: "kamp-us/demlik", number: 558 });
    expect(() => parseIssueRef("558")).toThrow("owner/repo#number");
  });

  it("splits fabrika's rewrite from the report as filed", () => {
    const split = splitEnriched(enriched);

    expect(split?.report).toBe(
      "## Summary\n`run` lets a pure machine leave `ctx` out, but `replay` still makes the caller pass one.\n\n---\n<sub>Filed by an agent · session `abc` · 2026-10-04T05:36:14Z</sub>",
    );
    expect(split?.enriched.startsWith("## In plain words")).toBe(true);
    expect(split?.enriched.endsWith("compiles for a machine with no ctx.")).toBe(true);
  });

  it("has nothing to split when fabrika never rewrote it", () => {
    expect(splitEnriched("## Summary\nIt breaks.")).toBeNull();
  });

  it("files only the original report, by an agent when fabrika's footer says so", () => {
    const raw = rawIssueFrom("558", { title: "replay needs ctx", body: enriched, author: { login: "someone", is_bot: false } });

    expect(raw.id).toBe("558");
    expect(raw.body.startsWith("## Summary")).toBe(true);
    expect(raw.body).not.toContain("In plain words");
    expect(raw.filedBy).toBe("agent");
  });

  it("files the whole body of an issue fabrika never rewrote, by a person unless a bot opened it", () => {
    const issue = { title: "t", body: "It breaks.\n", author: { login: "someone", is_bot: false } };

    expect(rawIssueFrom("1", issue)).toEqual({ id: "1", title: "t", body: "It breaks.", filedBy: "human" });
    expect(rawIssueFrom("1", { ...issue, author: { login: "bot", is_bot: true } }).filedBy).toBe("agent");
  });
});
