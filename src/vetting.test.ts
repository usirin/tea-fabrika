import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Issue } from "./issue.ts";
import { checkoutToy, localWorkspace } from "./local.ts";
import { Workspace } from "./services.ts";
import { nodeTests, TESTS_FILE, VET_TSCONFIG, vitestTests } from "./tests.ts";
import { classify, type Vetted, vetProblems } from "./vetting.ts";

const issue = (criteria: Issue["criteria"]): Issue => ({
  id: "slugify",
  title: "slugify makes slugs",
  goal: "slugify turns a title into a URL slug",
  body: "",
  criteria,
  openDecision: null,
});

const example = (id: string, call: string, result: string, file = "slugify.js"): Issue["criteria"][number] => ({
  kind: "example",
  id,
  rule: id,
  file,
  name: "slugify",
  uses: [],
  examples: [{ call, result }],
});

const vet = (dir: string, draft: Issue) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Workspace).vet(draft);
    }).pipe(Effect.provide(localWorkspace(dir, { test: ["node", "--test"] }))),
  );

const git = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });

describe("vetting a draft on today's code, in a fresh copy", () => {
  it("tells an example that fails from one that holds already and one that is broken", { timeout: 30_000 }, async () => {
    const toy = await checkoutToy("slugify");
    const draft = issue([
      example("lower", `slugify("Hello")`, `"hello"`),
      example("same", `slugify("abc")`, `"abc"`),
      example("throws", `slugify(undefined).length`, `0`),
    ]);
    const before = git(toy.dir, "status", "--porcelain");

    const vetted = await vet(toy.dir, draft);

    expect(vetted.missing).toEqual([]);
    expect(vetted.examples.map((e) => [e.criterion, e.verdict])).toEqual([
      ["lower", "fails"],
      ["same", "holds_already"],
      ["throws", "broken"],
    ]);
    expect(vetted.examples[0]?.detail).toContain("'Hello' !== 'hello'");
    expect(vetted.examples[2]?.detail).toMatch(/^throws: TypeError: /);
    // The folder the builder works in is as it was: no test file, no worktree left behind.
    expect(git(toy.dir, "status", "--porcelain")).toBe(before);
    expect(git(toy.dir, "worktree", "list").trim().split("\n")).toHaveLength(1);
  });

  it("calls every example broken when the file does not load, and names a file that is not at HEAD", { timeout: 30_000 }, async () => {
    const toy = await checkoutToy("slugify");
    const gone = { ...example("gone", `gone("a")`, `"a"`, "gone.js"), name: "gone" } as Issue["criteria"][number];
    const draft = issue([example("lower", `slugify("Hello")`, `"hello"`), gone]);

    const vetted = await vet(toy.dir, draft);

    expect(vetted.missing).toEqual([{ criterion: "gone", file: "gone.js" }]);
    expect(vetted.examples.map((e) => e.verdict)).toEqual(["broken", "broken"]);
    expect(vetted.examples[0]?.detail).toMatch(/^did not run: .*gone\.js/);
  });

  it("needs no fresh copy for a draft with no examples", async () => {
    const toy = await checkoutToy("slugify");
    const draft = issue([{ kind: "unchecked", id: "docs", rule: "The README says so", files: ["README.md"], about: "doc", why: "docs" }]);

    expect(await vet(toy.dir, draft)).toEqual({ missing: [{ criterion: "docs", file: "README.md" }], examples: [] });
  });
});

describe("what vetting tells the writer", () => {
  const draft = issue([example("lower", `slugify("Hello")`, `"hello"`), example("same", `slugify("abc")`, `"abc"`)]);
  const lower = { criterion: "lower", call: `slugify("Hello")` };
  const same = { criterion: "same", call: `slugify("abc")` };

  it("passes a draft whose every example fails and whose every file is there", () => {
    const vetted: Vetted = {
      missing: [],
      examples: [
        { ...lower, verdict: "fails", detail: "x" },
        { ...same, verdict: "fails", detail: "y" },
      ],
    };

    expect(vetProblems(draft, vetted)).toEqual([]);
  });

  it("sends back an example that holds already, one that is broken, and a file that is not there, each with what to do", () => {
    const vetted: Vetted = {
      missing: [{ criterion: "lower", file: "slugify.ts" }],
      examples: [
        { ...lower, verdict: "broken", detail: "does not typecheck: TS2345: Argument of type '{}' is not assignable" },
        { ...same, verdict: "holds_already", detail: "" },
      ],
    };
    const problems = vetProblems(draft, vetted);

    expect(problems).toHaveLength(4);
    expect(problems[0]).toBe("Criterion lower names slugify.ts, which does not exist at HEAD. Name the file as it is in the repo.");
    expect(problems[1]).toContain("If that type error is the bug itself, the rule is about types: make it unchecked with kind type");
    expect(problems[2]).toContain("already holds on today's code");
    expect(problems[2]).toContain("make it unchecked with that kind");
    expect(problems[3]).toBe("No example fails on today's code, so none shows what the change does.");
  });

  it("sends back ids used twice, and an example that was never run", () => {
    const twice = issue([example("lower", `slugify("Hello")`, `"hello"`), example("lower", `slugify("A")`, `"a"`)]);
    const problems = vetProblems(twice, { missing: [], examples: [{ ...lower, verdict: "fails", detail: "" }] });

    expect(problems).toEqual([
      "Criterion id lower is used more than once. Give each criterion its own id.",
      'Example `slugify("A")` (criterion lower) was not run. Write it again.',
    ]);
  });

  it("passes a draft that is all unchecked rules, about files that are there", () => {
    const unchecked = issue([{ kind: "unchecked", id: "types", rule: "ctx is optional", files: ["src/a.ts"], about: "type", why: "types" }]);

    expect(vetProblems(unchecked, { missing: [], examples: [] })).toEqual([]);
  });
});

describe("classifying a run", () => {
  const draft = issue([example("a", "f(1)", "1"), example("b", "f(2)", "2")]);
  const written = ['import { f } from "./f";', "", 'test("a: f(1)", () => {', "  expect(f(1)).toStrictEqual(1);", "});", "", 'test("b: f(2)", () => {', "  expect(f(2)).toStrictEqual(2);", "});"].join("\n");

  it("pins a type error to the example whose lines hold it, and an error in the imports to all of them", () => {
    const outcomes = { tests: new Map([["a: f(1)", { kind: "passed" as const }], ["b: f(2)", { kind: "passed" as const }]]), loadError: null };

    expect(classify(draft, written, outcomes, [{ line: 8, message: "TS2554: Expected 0 arguments" }]).map((e) => e.verdict)).toEqual([
      "holds_already",
      "broken",
    ]);
    expect(classify(draft, written, outcomes, [{ line: 1, message: "TS2305: no export f" }]).map((e) => e.verdict)).toEqual([
      "broken",
      "broken",
    ]);
  });
});

describe("a flavour reading its own report back", () => {
  it("node:test: an assertion is a failure, any other error is not", () => {
    const report = [
      "TAP version 13",
      "ok 1 - a: f(1)",
      "not ok 2 - b: f(3)",
      "  ---",
      "  error: |-",
      "    Expected values to be strictly deep-equal:",
      "    3 !== 4",
      "  code: 'ERR_ASSERTION'",
      "  name: 'AssertionError'",
      "  ...",
      "not ok 3 - c: f(2)",
      "  ---",
      "  error: 'bad x'",
      "  name: 'TypeError'",
      "  ...",
    ].join("\n");
    const { tests, loadError } = nodeTests.outcomes(report);

    expect(Object.fromEntries(tests)).toEqual({
      "a: f(1)": { kind: "passed" },
      "b: f(3)": { kind: "failed", assertion: true, error: "Expected values to be strictly deep-equal: 3 !== 4" },
      "c: f(2)": { kind: "failed", assertion: false, error: "TypeError: bad x" },
    });
    expect(loadError).toBeNull();
    expect(nodeTests.outcomes(`# SyntaxError: The requested module './m.js' does not provide an export named 'g'\nnot ok 1 - ${TESTS_FILE}`).loadError).toBe(
      "SyntaxError: The requested module './m.js' does not provide an export named 'g'",
    );
  });

  it("vitest: reads the issue's tests out of a whole package's tap-flat report, and a file that did not load", async () => {
    const flavour = vitestTests({ package: "packages/tea", file: "src/fabrika-scratch.test.ts" });
    const report = await readFile(join(import.meta.dirname, "..", "fixtures", "reports", "vitest-tap-flat.txt"), "utf8");
    const failed = await readFile(join(import.meta.dirname, "..", "fixtures", "reports", "vitest-load-failure.txt"), "utf8");
    const { tests } = flavour.outcomes(report);

    expect(tests.get("at-reads: at([1, 2], 0)")).toEqual({ kind: "passed" });
    expect(tests.get("at-reads: at([1, 2], 5)")).toEqual({ kind: "failed", assertion: true, error: "expected undefined to strictly equal 2" });
    expect(tests.has("acceptedTypes — transitions form > returns the refusing state's own row keys, not the table-wide union")).toBe(false);
    expect(flavour.outcomes(failed)).toEqual({
      tests: new Map(),
      loadError: "Cannot find module './does-not-exist' imported from /work/demlik/packages/tea/src/fabrika-scratch.test.ts",
    });
  });

  it("vitest: typechecks the file alone with the package's own settings, and reads back only that file's errors", () => {
    const flavour = vitestTests({ package: "packages/tea", file: "src/fabrika-558.test.ts", tsconfig: "tsconfig.test.json" });
    const check = flavour.typecheck;
    if (check === undefined) throw new Error("expected a typecheck");

    expect(JSON.parse(check.files[`packages/tea/${VET_TSCONFIG}`] ?? "")).toEqual({
      extends: "./tsconfig.test.json",
      compilerOptions: { noEmit: true },
      files: ["src/fabrika-558.test.ts"],
      include: [],
    });
    expect(check.run).toEqual(["pnpm", "--dir", "packages/tea", "exec", "tsc", "-p", VET_TSCONFIG]);
    const output = [
      "src/fabrika-558.test.ts(6,10): error TS2345: Argument of type '{ msgs: never[]; }' is not assignable to parameter.",
      "  Property 'ctx' is missing.",
      "src/runtime-types.ts(12,1): error TS1005: the repo's own",
    ].join("\n");
    expect(check.read(output)).toEqual([{ line: 6, message: "TS2345: Argument of type '{ msgs: never[]; }' is not assignable to parameter." }]);
    expect(vitestTests({ package: "packages/tea", file: "src/x.test.ts" }).typecheck).toBeUndefined();
  });
});
