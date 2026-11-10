import { describe, expect, it } from "vitest";
import type { FactOf } from "../../tickets/ticket.ts";
import type { Item } from "../build/ticket.ts";
import { tidyPaths } from "../mutation/stryker.ts";
import { priceOf } from "./agents.ts";
import { openWords, spentWords, withRed } from "./found.ts";

// What a red head says on a public ticket and to the builder. A test's name is the repository's
// text: markdown in it must not shape the comment, and a run's price nobody knows is never free.
describe("a red head, on the ticket", () => {
  it("the rounds' question shows a failing test as a code span, and a review's finding as words", () => {
    const open: readonly Item[] = [
      { criterion: null, text: "the [finding]", says: "s", where: [], wants: [] },
      {
        criterion: null,
        text: "src/a.test.ts > <!--",
        says: "s",
        where: [],
        wants: [],
        from: "tests",
      },
    ];
    const said = openWords(open).join("\n");
    expect(said).toContain("- `src/a.test.ts > <!--`");
    expect(said).not.toContain("`the [finding]`");
  });
});

describe("a red head after a review sent the work back", () => {
  const REVIEW: Item = {
    criterion: null,
    text: "the review's finding",
    says: "it is wrong",
    where: [],
    wants: [],
  };
  const OLD_RED: Item = { ...REVIEW, text: "src/old.test.ts > gone", from: "tests" };

  it("keeps what the review left open, beside each failing test", () => {
    const open = withRed([REVIEW], ["src/a.test.ts > fails"], "");
    expect(open.map((item) => item.text)).toEqual(["the review's finding", "src/a.test.ts > fails"]);
    expect(open[1]?.from).toBe("tests");
  });

  it("drops the last red's names: only what fails now is open", () => {
    const open = withRed([REVIEW, OLD_RED], ["src/a.test.ts > fails"], "");
    expect(open.map((item) => item.text)).toEqual(["the review's finding", "src/a.test.ts > fails"]);
  });
});

describe("what a run cost, when its step broke before it named a model", () => {
  const SPENT = { input: 1_000, cached: 0, output: 200, turns: 3, usd: null, misfits: 0 };

  it("a run with tokens and no model has a price nobody knows, never $0", () => {
    expect(priceOf(null, SPENT)).toEqual({ usd: 0, listUsd: null });
  });

  it("a run with no tokens and no model cost nothing", () => {
    const none = { ...SPENT, input: 0, output: 0 };
    expect(priceOf(null, none)).toEqual({ usd: 0, listUsd: 0 });
  });

  it("a model with a known rate is priced at it", () => {
    const picked = { harness: "codex", model: "gpt-6.1-sol", effort: "high", usd: 1 } as const;
    expect(priceOf(picked, SPENT).listUsd).toBeCloseTo((2 * 1_000 + 10 * 200) / 1_000_000);
  });

  it("such a run reads as price unknown on the rounds' question", () => {
    const { usd, listUsd } = priceOf(null, SPENT);
    const ended = {
      type: "ended",
      run: "r-build-5",
      stage: "build",
      outcome: { kind: "stuck", why: "run_failed" },
      usd,
      listUsd,
      input: 1_000,
      output: 200,
      turns: 3,
    } satisfies FactOf<"ended">;
    expect(spentWords([ended])).toContain("price unknown");
    expect(spentWords([ended])).not.toContain("$0");
  });
});

describe("the last lines of a run with no report, before a public ticket shows them", () => {
  it("say the copy as `.` and the home as `~`", () => {
    const text = ["FAIL /people/someone/fab/work/copies/abc123/src/a.test.ts", "at /people/someone/.cache/x.js:1"].join(
      "\n",
    );
    expect(tidyPaths(text, "/people/someone/fab/work/copies/abc123", "/people/someone")).toBe(
      ["FAIL ./src/a.test.ts", "at ~/.cache/x.js:1"].join("\n"),
    );
  });
});
