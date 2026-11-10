import { describe, expect, it } from "vitest";
import { failuresOf, type Report, resultsOf } from "./results.ts";

const TEST = { property: "p1", file: "a.test.ts", name: "says hi" };

const report = (entry: Report["testResults"][number]): Report => ({ testResults: [entry] });

describe("resultsOf", () => {
  it("reads a test that ran", () => {
    const ran = (status: string) =>
      report({
        name: "/x/a.test.ts",
        assertionResults: [{ title: "says hi", fullName: "s says hi", status }],
      });
    expect(resultsOf(ran("failed"), [TEST])).toEqual([{ property: "p1", result: "red" }]);
    expect(resultsOf(ran("passed"), [TEST])).toEqual([{ property: "p1", result: "green" }]);
    expect(resultsOf(ran("skipped"), [TEST])).toEqual([]);
  });

  it("reads a file that waits on code the build adds as red", () => {
    const message = "Error: Failed to resolve import ./a.ts from a.test.ts";
    const entry = { name: "/x/a.test.ts", status: "failed", message, assertionResults: [] };
    expect(resultsOf(report(entry), [TEST])).toEqual([{ property: "p1", result: "red" }]);
  });

  it("says nothing for a file that broke some other way, or a test it does not hold", () => {
    const broken = {
      name: "/x/a.test.ts",
      status: "failed",
      message: "SyntaxError: Unexpected token",
      assertionResults: [],
    };
    expect(resultsOf(report(broken), [TEST])).toEqual([]);
    expect(resultsOf({ testResults: [] }, [TEST])).toEqual([]);
  });
});

describe("failuresOf", () => {
  it("names a failing test by its file from the root, each describe, then its title", () => {
    const entry = {
      name: "/x/src/a.test.ts",
      status: "failed",
      assertionResults: [
        { title: "says hi", fullName: "s says hi", status: "passed" },
        {
          title: "says bye",
          fullName: "s says bye",
          status: "failed",
          ancestorTitles: ["s"],
          failureMessages: ["AssertionError: expected 1 to be 2\n    at a.test.ts:3"],
        },
      ],
    };
    expect(failuresOf(report(entry), "/x")).toEqual([
      { name: "src/a.test.ts > s > says bye", error: "AssertionError: expected 1 to be 2" },
    ]);
  });

  it("names a file that failed to load by its path, with the first line of why", () => {
    const entry = {
      name: "/x/src/a.test.ts",
      status: "failed",
      message: "\n  Error: Cannot find module ./b.ts\n    at a.test.ts:1",
      assertionResults: [],
    };
    expect(failuresOf(report(entry), "/x")).toEqual([
      { name: "src/a.test.ts", error: "Error: Cannot find module ./b.ts" },
    ]);
  });

  it("names nothing in a file that passed", () => {
    const entry = { name: "/x/src/a.test.ts", status: "passed", assertionResults: [] };
    expect(failuresOf(report(entry), "/x")).toEqual([]);
  });
});
