import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { nameOf } from "../outcome.ts";
import { Mutation, type MutationAsk, readScope, runMutants, runTests } from "./machine.ts";
import { changesOf, hashOf, type Scope } from "./scope.ts";
import { ASK, drive, FAILING, HEAD, KILLED_ALL, ONE_SURVIVED, RED, SCOPE, SURVIVED } from "./scripted.ts";

// The mutation step on fakes of its services: every branch, the Cmds it
// sends, and the report the lane reads.

const DISABLE = "\t// Stryker disable next-line EqualityOperator: n equal to low returns low either way";

describe("the mutation step", () => {
  it("runs the repo's own tests first, then Stryker over the changed source lines and the kept Property's code", () => {
    const { over, cmds } = drive({});
    expect(cmds.map((c) => c.type)).toEqual(["mutation_scope", "mutation_tests", "mutation_run"]);
    expect(cmds[1]).toEqual(runTests({ head: HEAD }));
    // The test file's added line is not mutated; the added lines sit inside the kept code's.
    expect(cmds[2]).toEqual(
      runMutants({
        head: HEAD,
        spans: [{ file: "src/clamp.ts", from: 9, to: 14 }],
        seed: 49,
        most: 150,
      }),
    );
    expect(over.phase === "over" && nameOf(over.outcome)).toBe("done");
    expect(over.phase === "over" && over.report.ran).toEqual(KILLED_ALL);
  });

  it("sends a mutant the weak test let survive to the test writer, with the mutant in the report", () => {
    const { over } = drive({ run: ONE_SURVIVED });

    if (over.phase !== "over") {
      throw new Error("over");
    }

    expect(nameOf(over.outcome)).toBe("send:test_writer:mutant_survived");
    expect(over.report.ran?.survived).toEqual([SURVIVED]);
  });

  it("asks the owner about a disable comment the diff adds, quoted, before anything runs", () => {
    const added = { file: "src/clamp.ts", line: 11, text: DISABLE };
    const scope = { ...SCOPE, diff: { ...SCOPE.diff, added: [...SCOPE.diff.added, added] } };
    const { over, cmds } = drive({ scope });

    if (over.phase !== "over") {
      throw new Error("over");
    }

    expect(nameOf(over.outcome)).toBe("ask:owner:check_change");
    expect(over.report.changes).toEqual([{ kind: "disable", ...added, text: DISABLE.trim() }]);
    expect(cmds.map((c) => c.type)).toEqual(["mutation_scope"]);
  });

  it("asks the owner when the diff edits the ignorer", () => {
    const exam = "packages/pipeline/src/stages/mutation/ignorer.ts";
    const scope = { ...SCOPE, diff: { ...SCOPE.diff, files: [...SCOPE.diff.files, exam] } };
    const { over } = drive({ scope });

    if (over.phase !== "over") {
      throw new Error("over");
    }

    expect(nameOf(over.outcome)).toBe("ask:owner:check_change");
    // The read gave no hash for it, so no approval could hold.
    expect(over.report.changes).toEqual([{ kind: "exam", file: exam, hash: null }]);
  });

  it("reads each file of the exam at the head, with the diff", () => {
    const { cmds } = drive({});
    expect(cmds[0]).toEqual(readScope({ base: ASK.base, head: HEAD, kept: ASK.kept, exam: ASK.exam }));
  });

  describe("an approval of an ignorer edit holds for its contents at the head only", () => {
    const file = "ignorer.ts";
    /** The diff touches the ignorer; `added` is what it adds, `contents` how the file reads after. */
    const edit = (contents: string, added: readonly string[]) => ({
      ...SCOPE,
      diff: { files: [file], added: added.map((text, i) => ({ file, line: i + 1, text })) },
      exam: [{ file, hash: hashOf(contents) }],
    });
    const line = "export const logs = /^debug:/;";
    const approved = edit(`export const keep = /^error:/;\n${line}\n`, [line]);
    const ask = { ...ASK, exam: [file], allowed: changesOf(approved, [file]) };
    const name = (scope: Scope) => {
      const { over } = drive({ scope }, ask);
      return over.phase === "over" && nameOf(over.outcome);
    };

    it("runs on the contents the owner approved", () => {
      expect(name(approved)).toBe("done");
    });

    it("asks again after an edit that adds a line", () => {
      const all = "export const all = /./;";
      expect(name(edit(`export const keep = /^error:/;\n${all}\n`, [all]))).toBe("ask:owner:check_change");
    });

    it("asks again after an edit that only deletes a line", () => {
      // The same lines added; only the contents at the head tell the edit apart.
      expect(name(edit(`${line}\n`, [line]))).toBe("ask:owner:check_change");
    });

    it("asks again when the file is gone at the head", () => {
      expect(name({ ...approved, exam: [{ file, hash: null }] })).toBe("ask:owner:check_change");
    });
  });

  it("runs once the owner approved the change, even after the line moved", () => {
    const added = { file: "src/clamp.ts", line: 11, text: DISABLE };
    const scope = { ...SCOPE, diff: { ...SCOPE.diff, added: [...SCOPE.diff.added, added] } };
    const allowed = [{ kind: "disable" as const, file: "src/clamp.ts", line: 30, text: DISABLE.trim() }];
    const { over } = drive({ scope }, { ...ASK, allowed });
    expect(over.phase === "over" && nameOf(over.outcome)).toBe("done");
  });

  it("skips when no source line changed and no kept Property covers one", () => {
    const scope = {
      diff: { files: ["README.md"], added: [{ file: "README.md", line: 1, text: "# hi" }] },
      kept: [],
      exam: [],
    };
    const { over, cmds } = drive({ scope }, { ...ASK, kept: [] });
    expect(over.phase === "over" && nameOf(over.outcome)).toBe("skip:no_lines");
    expect(cmds).toHaveLength(1);
  });

  it("sends a head whose own tests fail back to the builder, with each failing test by name, before Stryker runs", () => {
    const { over, cmds } = drive({ tests: RED });

    if (over.phase !== "over") {
      throw new Error("over");
    }

    expect(nameOf(over.outcome)).toBe("send:builder:tests_red");
    expect(over.report.failed).toEqual([FAILING]);
    expect(cmds.map((c) => c.type)).toEqual(["mutation_scope", "mutation_tests"]);
  });

  it("names no failing test after a green run", () => {
    const { over } = drive({});
    expect(over.phase === "over" && over.report.failed).toEqual([]);
  });

  it("is stuck, never guessing, when the diff cannot be read or a run fails", () => {
    const name = (script: Parameters<typeof drive>[0]) => {
      const { over } = drive(script);
      return over.phase === "over" ? nameOf(over.outcome) : over.phase;
    };
    expect(name({ scope: "fail" })).toBe("stuck:read_failed");
    expect(name({ tests: "fail" })).toBe("stuck:run_failed");
    expect(name({ run: "fail" })).toBe("stuck:run_failed");
  });

  it("asks again for what was in flight after a restart, and ends the same", () => {
    for (const restartAt of ["reading", "testing", "mutating"] as const) {
      const { over, cmds } = drive({ run: ONE_SURVIVED, restartAt });
      expect(over.phase === "over" && nameOf(over.outcome)).toBe("send:test_writer:mutant_survived");
      expect(cmds).toHaveLength(4);
    }
  });
});

// Self-fix PR 4: code ran `[build] checks` at the head just before this step. On a green run at
// this very head the step skips its own suite run, and its report names the checks it trusted, so
// a skip never looks like a clean run. Any other checks, or none, and it runs the tests as before.
describe("the mutation step after code's checks", () => {
  const COMMANDS = [
    {
      command: "node_modules/.bin/vitest run --reporter=json --outputFile={out}",
      code: 0,
      ms: 4_210,
    },
  ];
  const checkedAt = (head: string, result: "green" | "red" | "not_run") => ({
    head,
    commands: COMMANDS,
    result,
    failed: result === "red" ? [FAILING] : [],
  });
  const GREEN_HERE = checkedAt(HEAD, "green");
  const decode = Schema.decodeUnknownSync(Mutation);
  const encode = Schema.encodeSync(Mutation);

  it("skips its own suite run on green checks at its head, and names them in the report", () => {
    const { over, cmds } = drive({ tests: RED }, { ...ASK, checked: GREEN_HERE } as MutationAsk);
    expect(cmds.map((c) => c.type)).toEqual(["mutation_scope", "mutation_run"]);

    if (over.phase !== "over") {
      throw new Error("over");
    }

    expect(nameOf(over.outcome)).toBe("done");
    expect((over.report as { readonly trusted?: unknown }).trusted).toEqual(GREEN_HERE);
  });

  it.each([
    ["green at another head", checkedAt("o".repeat(40), "green")],
    ["red at its head", checkedAt(HEAD, "red")],
    ["not_run at its head", checkedAt(HEAD, "not_run")],
  ])("runs its own tests first on checks %s, and trusts none", (_, checked) => {
    const { over, cmds } = drive({}, { ...ASK, checked } as MutationAsk);
    expect(cmds.map((c) => c.type)).toEqual(["mutation_scope", "mutation_tests", "mutation_run"]);

    if (over.phase !== "over") {
      throw new Error("over");
    }

    expect((over.report as { readonly trusted?: unknown }).trusted ?? null).toBeNull();
  });

  it("keeps the checks it was asked with through its schema, and the ones it trusted, so a restart reads them back", () => {
    const { over } = drive({}, { ...ASK, checked: GREEN_HERE } as MutationAsk);
    const back = decode(encode(over));
    expect(back).toEqual(over);
    expect((back as { readonly ask?: { readonly checked?: unknown } }).ask?.checked).toEqual(GREEN_HERE);
  });

  it("a Stryker run that fails after a skip still says what it would have mutated and which checks it trusted", () => {
    const { over } = drive({ run: "fail" }, { ...ASK, checked: GREEN_HERE } as MutationAsk);

    if (over.phase !== "over") {
      throw new Error("over");
    }

    expect(nameOf(over.outcome)).toBe("stuck:run_failed");
    expect(over.report.spans).toEqual([{ file: "src/clamp.ts", from: 9, to: 14 }]);
    expect((over.report as { readonly trusted?: unknown }).trusted).toEqual(GREEN_HERE);
  });

  it("skips the same after a restart while it reads the diff", () => {
    const { over, cmds } = drive({ tests: RED, restartAt: "reading" }, {
      ...ASK,
      checked: GREEN_HERE,
    } as MutationAsk);
    expect(cmds.map((c) => c.type)).toEqual(["mutation_scope", "mutation_scope", "mutation_run"]);
    expect(over.phase === "over" && nameOf(over.outcome)).toBe("done");
  });
});
