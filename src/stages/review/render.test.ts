import { describe, expect, it } from "vitest";
import { HEADINGS, render, renderKind } from "./render.ts";
import { type Form, idOf, readForm, type Sheet } from "./sheet.ts";
import { briefOf, WHOLE } from "./scripted.ts";
import { verdictsOf } from "./verdict.ts";

// The printout. Its three headings are there every time, in the same order.

const BRIEF = briefOf(WHOLE);
const sheetOf = (form: Form, brief = BRIEF): Sheet => {
  const made = readForm(brief, form);
  if (made.answer !== "sheet") throw new Error(made.problems.join("; "));
  return made.sheet;
};
const comments = (form: Form, brief = BRIEF) => {
  const sheet = sheetOf(form, brief);
  return render(brief, sheet, verdictsOf(brief.kinds, sheet));
};

const FOUND = {
  kind: "review-doc",
  from: { source: "criterion", n: 2 },
  fault: "No page says what exit 3 means.",
  at: null,
  proof: "Grep for `exit 3` under docs/ finds nothing.",
  wants: "The reference page names exit 3.",
} as const;
const FAILING: Form = {
  rows: [
    { n: 1, grade: "pass", where: [{ file: "src/a.ts", first: 3, last: 9 }, { file: "src/a.test.ts", first: 20, last: 20 }], says: "The test covers it.", limit: "Read, not run." },
    { n: 2, grade: "fail", where: [], says: "No page says it." },
  ],
  findings: [FOUND, { kind: "review-code", from: { source: "check", name: "no-silent-catch" }, fault: "The catch drops\nthe error.", at: { file: "src/a.ts", first: 12, last: 14 }, proof: "It returns 0.", wants: "Report it." }],
  skipped: [{ what: "The test run", why: "No shell." }],
};
const PASSING: Form = {
  rows: [
    { n: 1, grade: "pass", where: [], says: "The test covers it.", limit: null },
    { n: 2, grade: "pass", where: [{ file: "docs/a.md", first: 4, last: 6 }], says: "The page says it.", limit: null },
  ],
  findings: [],
  skipped: [],
};

describe("the printout", () => {
  it("prints one comment per kind, each with the three headings in the same order", () => {
    for (const form of [FAILING, PASSING]) {
      const printed = comments(form);
      expect(printed.map((comment) => comment.kind)).toEqual(["review-code", "review-doc"]);
      for (const { text } of printed) {
        const at = [HEADINGS.change, HEADINGS.rows, HEADINGS.unseen].map((heading) => text.indexOf(`\n${heading}\n`));
        expect(at.every((index) => index > 0)).toBe(true);
        expect([...at].sort((a, b) => a - b)).toEqual(at);
        expect(text.match(/^## /gm)).toHaveLength(3);
      }
    }
  });

  it("prints a failing doc review whole", () => {
    const [, doc] = comments(FAILING);
    expect(doc?.text).toBe(
      [
        "**review-doc: fail** at `aaaaaaa`, against example/repo#3",
        "",
        "## What has to change",
        "",
        `- **${idOf(FOUND)}** (nothing to point at), from criterion 2`,
        "  - Fault: No page says what exit 3 means.",
        "  - Proof: Grep for `exit 3` under docs/ finds nothing.",
        "  - Wants: The reference page names exit 3.",
        "",
        "## Criteria",
        "",
        "1. **pass**: it works",
        "   - The test covers it. (`src/a.ts:3-9`, `src/a.test.ts:20`)",
        "   - Limit: Read, not run.",
        "2. **fail**: it is written down",
        "   - No page says it.",
        "",
        "## Not looked at",
        "",
        "- The test run: No shell.",
        "- The required checks were read at this commit (green). They were not run again.",
        "",
      ].join("\n"),
    );
  });

  it("lists a finding under its own kind only, with its id, its place and where it came from, on one line each", () => {
    const [code, doc] = comments(FAILING);
    expect(code?.text).toContain("**code-");
    expect(code?.text).toContain("`src/a.ts:12-14`, from standing check: no-silent-catch");
    expect(code?.text).toContain("  - Fault: The catch drops the error.");
    expect(code?.text).not.toContain(idOf(FOUND));
    expect(doc?.text).not.toContain("no-silent-catch");
    // A failed row fails every kind, so the code review fails too, and shows the row.
    expect(code?.text).toMatch(/^\*\*review-code: fail\*\*/);
    expect(code?.text).toContain("2. **fail**: it is written down");
  });

  it("says nothing has to change, out loud, on a pass", () => {
    const [code] = comments(PASSING);
    expect(code?.text).toMatch(/^\*\*review-code: pass\*\*/);
    expect(code?.text).toContain("## What has to change\n\nNothing.\n\n## Criteria");
  });

  it("puts a row that could not be seen, and a kind this stage does not do, under what was not looked at", () => {
    const brief = briefOf({ ...WHOLE, kinds: ["review-code", "governance"], rubrics: WHOLE.rubrics });
    const form: Form = { ...PASSING, rows: [PASSING.rows[0] as Form["rows"][number], { n: 2, grade: "unseen", says: "Its proof is in the pull request's text." }] };
    const sheet = sheetOf(form, brief);
    const text = renderKind(brief, sheet, { kind: "review-code", verdict: "unseen" });
    expect(text).toMatch(/^\*\*review-code: unseen\*\*/);
    const notLooked = text.slice(text.indexOf(HEADINGS.unseen));
    expect(notLooked).toContain("- Criterion 2: Its proof is in the pull request's text.");
    expect(notLooked).toContain("- governance: the change owes this review too. This stage does not do it.");
    expect(text).toContain("2. **unseen**: it is written down");
  });

  it("does not print a closed finding as something that has to change", () => {
    const sheet = sheetOf(FAILING);
    const closed = { ...sheet, findings: sheet.findings.map((finding) => ({ ...finding, state: "closed" as const })) };
    expect(renderKind(BRIEF, closed, { kind: "review-doc", verdict: "fail" })).toContain("## What has to change\n\nNothing.");
  });
});
