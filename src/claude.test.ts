import { describe, expect, it } from "vitest";
import { promptFor } from "./claude.ts";
import type { Issue } from "./issue.ts";

const issue: Issue = {
  id: "1",
  title: "slugify turns a title into a URL slug",
  body: "Make slugify(title) return a URL slug.",
  criteria: [
    { id: "lower", text: "The slug is lower case" },
    { id: "dashes", text: "Spaces become single dashes" },
    { id: "ascii", text: "Punctuation is removed" },
  ],
};

describe("the prompt Claude gets", () => {
  it("carries the whole issue on the first build", () => {
    const prompt = promptFor({ issue, feedback: null, session: null });

    expect(prompt).toContain(issue.title);
    expect(prompt).toContain(issue.body);
    for (const criterion of issue.criteria) expect(prompt).toContain(criterion.text);
  });

  it("is only the feedback on a retry, because the conversation holds the rest", () => {
    const prompt = promptFor({ issue, feedback: "Tests failed: dashes", session: "abc" });

    expect(prompt).toContain("Tests failed: dashes");
    expect(prompt).not.toContain(issue.body);
  });

  it("repeats the issue when feedback arrives with no conversation to resume", () => {
    const prompt = promptFor({ issue, feedback: "Tests failed: dashes", session: null });

    expect(prompt).toContain(issue.body);
    expect(prompt).toContain("Tests failed: dashes");
  });
});
