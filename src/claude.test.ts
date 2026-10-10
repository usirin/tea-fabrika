import { describe, expect, it } from "vitest";
import { enrichPromptFor, promptFor } from "./claude.ts";
import type { Issue } from "./issue.ts";
import { rulingNote } from "./triage.ts";

const issue: Issue = {
  id: "1",
  title: "slugify turns a title into a URL slug",
  goal: "slugify turns a title into a URL slug",
  body: "Make slugify(title) return a URL slug.",
  criteria: [
    { kind: "example", id: "lower", rule: "The slug is lower case", file: "slugify.js", name: "slugify", examples: [{ call: `slugify("Hi")`, result: `"hi"` }] },
    { kind: "unchecked", id: "docs", rule: "The README shows an example", why: "it is about docs" },
  ],
  openDecision: null,
};

describe("the prompt the enricher gets", () => {
  const raw = { id: "1", title: "slugs look wrong", body: "spaces stay in", filedBy: "human" } as const;

  it("asks for the call nobody has made on the first turn", () => {
    const prompt = enrichPromptFor({ raw, note: null, session: null });

    expect(prompt).toContain(raw.body);
    expect(prompt).toContain("open_decision");
  });

  it("is only the owner's ruling once the conversation holds the issue", () => {
    const note = rulingNote("Keep accents or drop them?", "Drop them.");
    const prompt = enrichPromptFor({ raw, note, session: "enricher-1" });

    expect(prompt).toBe(note);
    expect(prompt).toContain("Keep accents or drop them?");
    expect(prompt).toContain("Drop them.");
  });
});

describe("the prompt Claude gets", () => {
  it("carries the whole issue on the first build", () => {
    const prompt = promptFor({ issue, feedback: null, session: { id: "abc", continues: false } });

    expect(prompt).toContain(issue.title);
    expect(prompt).toContain(issue.body);
    for (const criterion of issue.criteria) expect(prompt).toContain(criterion.rule);
    // The builder sees each example exactly as its test asserts it.
    expect(prompt).toContain(`slugify("Hi") -> "hi"`);
  });

  it("is only the feedback on a retry, because the conversation holds the rest", () => {
    const prompt = promptFor({ issue, feedback: "Tests failed: dashes", session: { id: "abc", continues: true } });

    expect(prompt).toContain("Tests failed: dashes");
    expect(prompt).not.toContain(issue.body);
  });

  it("repeats the issue when feedback arrives with no conversation to resume", () => {
    const prompt = promptFor({ issue, feedback: "Tests failed: dashes", session: { id: "abc", continues: false } });

    expect(prompt).toContain(issue.body);
    expect(prompt).toContain("Tests failed: dashes");
  });
});
