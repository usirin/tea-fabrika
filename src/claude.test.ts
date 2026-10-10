import { describe, expect, it } from "vitest";
import { enrichPromptFor, kindOf, promptFor } from "./claude.ts";
import type { Issue } from "./issue.ts";
import { rulingNote } from "./triage.ts";

const issue: Issue = {
  id: "1",
  title: "slugify turns a title into a URL slug",
  goal: "slugify turns a title into a URL slug",
  body: "Make slugify(title) return a URL slug.",
  criteria: [
    { kind: "example", id: "lower", rule: "The slug is lower case", file: "slugify.js", name: "slugify", uses: [], examples: [{ call: `slugify("Hi")`, result: `"hi"` }] },
    { kind: "unchecked", id: "docs", rule: "The README shows an example", files: ["README.md"], about: "doc", why: "it is about docs" },
  ],
  openDecision: null,
};

/** A criterion as the enricher writes it, every field set the way an unused one is. */
const written = {
  id: "docs",
  rule: "The README shows an example",
  file: "",
  name: "",
  uses: [],
  examples: [],
  no_example: "it is about docs",
  files: [],
  unchecked_kind: "doc" as const,
};

describe("a criterion the enricher wrote", () => {
  it("keeps the files a rule without examples is about, its file among them, once each, and what it is about", () => {
    expect(kindOf({ ...written, file: "README.md", files: ["README.md", " docs/a.md ", ""] })).toEqual({
      kind: "unchecked",
      id: "docs",
      rule: "The README shows an example",
      files: ["README.md", "docs/a.md"],
      about: "doc",
      why: "it is about docs",
    });
  });

  it("may be about no file at all", () => {
    expect(kindOf(written)).toMatchObject({ kind: "unchecked", files: [] });
  });

  it("keeps the names an example's calls use", () => {
    const uses = [{ name: "defineMachine", file: "src/index.ts" }];
    const criterion = kindOf({
      ...written,
      id: "replays",
      file: "src/replay.ts",
      name: "replay",
      uses,
      examples: [{ call: "replay(defineMachine({}), { msgs: [] }).state", result: "0" }],
      no_example: null,
    });

    expect(criterion).toMatchObject({ kind: "example", file: "src/replay.ts", name: "replay", uses });
  });
});

describe("the prompt the enricher gets", () => {
  const raw = { id: "1", title: "slugs look wrong", body: "spaces stay in", filedBy: "human" } as const;

  it("asks for the call nobody has made on the first turn", () => {
    const prompt = enrichPromptFor({ raw, facts: null, note: null, session: null });

    expect(prompt).toContain(raw.body);
    expect(prompt).toContain("open_decision");
  });

  it("asks for examples that use the library as its users do and need no unasked change", () => {
    const prompt = enrichPromptFor({ raw, facts: null, note: null, session: null });

    expect(prompt).toContain("build it inline with the library's own constructor");
    expect(prompt).toContain("must need no change the issue does not ask for");
    expect(prompt).toContain("list in files the files it is about");
  });

  it("says each example must fail on today's code, and asks what an unchecked rule is about", () => {
    const prompt = enrichPromptFor({ raw, facts: null, note: null, session: null });

    expect(prompt).toContain("its assertion must fail");
    expect(prompt).toContain("unchecked_kind");
    expect(prompt).not.toContain("even when the starting code happens to follow it already");
  });

  it("starts from what code found, when it found anything", () => {
    const facts = {
      names: [
        {
          name: "slugify",
          calledIn: null,
          definitions: [
            {
              file: "slugify.js",
              line: 1,
              exported: true,
              signature: "export function slugify(title)",
              package: "slugify",
              published: [{ subpath: ".", tier: null }],
              callers: null,
            },
          ],
          more: 0,
          mentionedIn: 2,
        },
      ],
      paths: [],
      pages: [],
      refs: [],
    };
    const prompt = enrichPromptFor({ raw, facts, note: null, session: null });

    expect(prompt).toContain("What code found in this folder");
    expect(prompt).toContain("export function slugify(title)");
    expect(prompt).not.toContain("checked through its twin");
    expect(enrichPromptFor({ raw, facts: null, note: null, session: null })).not.toContain("What code found");
  });

  it("says a doc page with a twin is checked through it, not unchecked doc", () => {
    const facts = { names: [], paths: [], pages: [{ page: "docs/use.md", twins: ["src/docs/use.test.ts"], more: 0 }], refs: [] };
    const prompt = enrichPromptFor({ raw, facts, note: null, session: null });

    expect(prompt).toContain("`src/docs/use.test.ts`");
    expect(prompt).toContain("name the twin in the criterion's files beside the page, and do not call the rule unchecked doc");
  });

  it("is only the owner's ruling once the conversation holds the issue", () => {
    const note = rulingNote("Keep accents or drop them?", "Drop them.");
    const prompt = enrichPromptFor({ raw, facts: null, note, session: "enricher-1" });

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
    // And the files an unchecked rule is about, so it knows they are in scope.
    expect(prompt).toContain("(docs; in README.md)");
  });

  it("tells the builder to answer contradiction rather than change what the issue does not ask for", () => {
    const prompt = promptFor({ issue, feedback: null, session: { id: "abc", continues: false } });

    expect(prompt).toMatch(/only typecheck, by changing something this issue does not ask for[^]*answer contradiction/);
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
