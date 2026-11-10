import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "vitest";
import { sentBack } from "../../refine.ts";
import { nameOf } from "../outcome.ts";
import {
  commitTests,
  onBase,
  readChecked,
  readTaken,
  recordFacts,
  runSub,
  type TestWriter,
  type TestWriterCmd,
  testWriter,
} from "./machine.ts";
import { ASK, BASE, COMMIT, drive, GOOD, pid } from "./scripted.ts";
import type { Written } from "./written.ts";

// The test writer from `start` to `over`, every outside thing answered by a
// script (./scripted.ts). No agent, no box, no test runner.

const intent = (step: string) => `tests/acme/widgets#7/1/${step}`;

const cannot: Written = {
  ...GOOD,
  answers: [
    ...GOOD.answers.slice(0, 1),
    { property: pid("p2"), kind: "cannot", why: "a healthy exit leaves nothing to read" },
  ],
};

describe("the test writer", () => {
  it("writes one test per Property, commits them on the base, runs them, records and reads back: done", () => {
    const { over, cmds, prompts } = drive({ drafts: [GOOD] });
    expect(over).toMatchObject({
      phase: "over",
      outcome: { kind: "done", part: false, commit: COMMIT },
      report: { commit: COMMIT, found: [], tries: 1, costUsd: 0.25 },
    });
    expect(nameOf(over.phase === "over" ? over.outcome : { kind: "done", part: false })).toBe("done");
    const checked = [
      { fact: "checked", property: pid("p1"), version: 1, head: COMMIT, tool: "test", result: "red" },
      {
        fact: "checked",
        property: pid("p2"),
        version: 1,
        head: COMMIT,
        tool: "test",
        result: "green",
      },
    ] as const;
    expect(cmds).toEqual([
      readTaken({ base: BASE, includes: ASK.includes }),
      commitTests({
        ticket: ASK.ticket,
        base: BASE,
        files: GOOD.files,
        intent: intent("commit"),
      }),
      onBase({
        commit: COMMIT,
        tests: GOOD.answers.flatMap((a) =>
          a.kind === "test" ? [{ property: a.property, file: a.file, name: a.name }] : [],
        ),
      }),
      recordFacts({
        ticket: ASK.ticket,
        written: { fact: "tests_written", ticket: ASK.ticket, commit: COMMIT },
        checked: [...checked],
        intent: intent("record"),
      }),
      readChecked({ ticket: ASK.ticket, version: 1, head: COMMIT }),
    ]);
    expect(prompts[0]).toContain("These exist already, so they are never written:");
  });

  it("sends an edit to an existing file back to the writer, and goes on once it adds a new one", () => {
    const edit: Written = {
      ...GOOD,
      files: [{ path: "packages/pipeline/src/hosted/lane.test.ts", text: "changed" }],
      answers: GOOD.answers.map((a) =>
        a.kind === "test" ? { ...a, file: "packages/pipeline/src/hosted/lane.test.ts" } : a,
      ),
    };
    const { over, prompts } = drive({ drafts: [edit, GOOD] });
    expect(prompts[1]).toBe(
      sentBack([
        "`packages/pipeline/src/hosted/lane.test.ts` exists already. Never change a file that exists: add a new one.",
      ]),
    );
    expect(over).toMatchObject({ outcome: { kind: "done" }, report: { tries: 2, costUsd: 0.5 } });
  });

  it("asks the owner `already_passes` when a new Property's test is green on the base", () => {
    const { over } = drive({ drafts: [GOOD], run: { p1: "green", p2: "green" } });
    expect(over).toMatchObject({
      outcome: { kind: "ask", who: "owner", for: "already_passes" },
      report: { commit: COMMIT, found: [{ property: "p1", for: "already_passes" }] },
    });
  });

  it("asks the owner `fails_on_base` when an existing Property's test is red there, and records both results first", () => {
    const { over, cmds } = drive({ drafts: [GOOD], run: { p1: "red", p2: "red" } });
    expect(over).toMatchObject({ outcome: { kind: "ask", who: "owner", for: "fails_on_base" } });
    expect(cmds.find((c) => c.type === "tests_record")).toMatchObject({
      checked: [
        { property: "p1", result: "red" },
        { property: "p2", result: "red" },
      ],
    });
  });

  it("asks `cannot_test` for a Property no test can check, after running the others", () => {
    const { over, cmds } = drive({ drafts: [cannot] });
    expect(over).toMatchObject({
      outcome: { kind: "ask", who: "owner", for: "cannot_test" },
      report: {
        checked: [{ property: "p1", result: "red" }],
        found: [{ property: "p2", for: "cannot_test" }],
      },
    });
    expect(cmds.map((c) => c.type)).toContain("tests_on_base");
  });

  it("asks `cannot_test` at once, with no commit, when no Property got a test", () => {
    const none: Written = {
      files: [],
      answers: [
        { property: pid("p1"), kind: "cannot", why: "x" },
        { property: pid("p2"), kind: "cannot", why: "y" },
      ],
    };
    const { over, cmds } = drive({ drafts: [none] });
    expect(over).toMatchObject({
      outcome: { kind: "ask", for: "cannot_test" },
      report: { commit: null, found: [{ property: "p1" }, { property: "p2" }] },
    });
    expect(cmds.map((c) => c.type)).toEqual(["tests_taken"]);
  });

  it("skips a plan with no Property, and asks for nothing", () => {
    const { over, cmds } = drive({ drafts: [] }, { ...ASK, properties: [] });
    expect(over).toMatchObject({ outcome: { kind: "skip", why: "no_properties" } });
    expect(cmds).toEqual([]);
  });

  it("is stuck `unchecked` out of tries, with the last draft and its problems", () => {
    const { over } = drive({ drafts: [{ ...GOOD, answers: [] }] }, { ...ASK, tries: 1 });
    expect(over).toMatchObject({
      outcome: { kind: "stuck", why: "unchecked" },
      report: { written: { answers: [] }, tries: 1 },
    });

    if (over.phase !== "over") {
      throw new Error("over");
    }

    expect(over.report.problems).toHaveLength(2);
  });

  it("is stuck `draft_failed` when the writer breaks or its answer does not fit", () => {
    expect(drive({ drafts: [{ error: "boom" }] }).over).toMatchObject({
      outcome: { why: "draft_failed" },
      report: { problems: ["boom"] },
    });
    expect(drive({ drafts: [null] }).over).toMatchObject({ outcome: { why: "draft_failed" } });
  });

  it("stops, never guesses, when a read, write or run fails", () => {
    expect(drive({ drafts: [], taken: "fail" }).over).toMatchObject({ outcome: { why: "read_failed" } });
    expect(drive({ drafts: [GOOD], commit: "fail" }).over).toMatchObject({
      outcome: { why: "commit_failed" },
    });
    expect(drive({ drafts: [GOOD], run: "fail" }).over).toMatchObject({
      outcome: { why: "run_failed" },
      report: { commit: COMMIT },
    });
    expect(drive({ drafts: [GOOD], run: { p2: "green" } }).over).toMatchObject({
      outcome: { why: "no_result" },
      report: { problems: ["the run on the base said nothing for p1's test"] },
    });
    expect(drive({ drafts: [GOOD], record: "fail" }).over).toMatchObject({
      outcome: { why: "record_failed" },
    });
    expect(drive({ drafts: [GOOD], back: (wrote) => wrote.slice(1) }).over).toMatchObject({
      outcome: { why: "record_failed" },
      report: { problems: ["the ledger, read after the write, does not show every result"] },
    });
  });

  // Tracker 193: ticket 117's run on the base failed, and the stuck comment said nothing. The cause
  // rides beside the `could_not_run` tag, and the rows the writer could not test are kept.
  describe("a run on the base that fails", () => {
    /** Ticket 117's failure, as the box would tell it. Made up: the cause and the code. */
    const NO_REPORT = { why: "no_report", code: 1, ms: 726_000, tail: "Error: boom" } as const;

    it("stays stuck `run_failed`, and keeps the cause the run gave", () => {
      const { over } = drive({ drafts: [GOOD], run: "fail", failure: NO_REPORT });
      expect(over).toMatchObject({
        outcome: { kind: "stuck", why: "run_failed" },
        report: { commit: COMMIT, failure: { _tag: "could_not_run", ...NO_REPORT } },
      });
    });

    it.each([
      { why: "no_command", code: null, ms: 0, tail: "[test_writer] run is not set" },
      { why: "copy_failed", code: null, ms: 12, tail: "fatal: no room left" },
      { why: "box_failed", code: null, ms: 40, tail: "srt: could not start" },
      { why: "no_report", code: 1, ms: 726_000, tail: "Error: boom" },
      { why: "bad_report", code: 0, ms: 3_100, tail: "" },
    ])("keeps a `$why` cause whole, its code `$code` too", (failure) => {
      const { over } = drive({ drafts: [GOOD], run: "fail", failure });
      expect(over).toMatchObject({
        outcome: { why: "run_failed" },
        report: { failure: { _tag: "could_not_run", ...failure } },
      });
    });

    it("a bare `could_not_run`, as code from before this says it, keeps no cause and keeps the commit", () => {
      expect(drive({ drafts: [GOOD], run: "fail" }).over).toMatchObject({
        outcome: { kind: "stuck", why: "run_failed" },
        report: { commit: COMMIT, failure: null },
      });
    });

    it("a run that does not fail keeps no cause", () => {
      expect(drive({ drafts: [GOOD] }).over).toMatchObject({
        outcome: { kind: "done" },
        report: { failure: null },
      });
    });

    it("keeps no cause that is not one of the five, and stops all the same", () => {
      const { over } = drive({
        drafts: [GOOD],
        run: "fail",
        failure: { why: "made_up", code: 1, ms: 5, tail: "x" },
      });
      expect(over).toMatchObject({
        outcome: { kind: "stuck", why: "run_failed" },
        report: { commit: COMMIT, failure: null },
      });
    });

    it("keeps one `cannot_test` row for each Property the writer said no test can check", () => {
      const { over } = drive({ drafts: [cannot], run: "fail", failure: NO_REPORT });
      expect(over).toMatchObject({
        outcome: { kind: "stuck", why: "run_failed" },
        report: { found: [{ property: "p2", for: "cannot_test" }] },
      });
    });

    // The stuck comment says each cause in words: the five, with the code and the time each gave.
    it.each([
      {
        failure: { why: "no_command", code: null, ms: 0, tail: "[test_writer] run is not set" },
        words:
          "The run on the base failed (no_command): no test command could be read from the settings, with no exit code, after 0.0 s.",
      },
      {
        failure: { why: "copy_failed", code: null, ms: 12, tail: "fatal: no room left" },
        words:
          "The run on the base failed (copy_failed): no copy of the commit could be made to run the tests in, with no exit code, after 0.0 s.",
      },
      {
        failure: { why: "box_failed", code: null, ms: 40, tail: "srt: could not start" },
        words:
          "The run on the base failed (box_failed): the box the tests run in failed, with no exit code, after 0.0 s.",
      },
      {
        failure: NO_REPORT,
        words:
          "The run on the base failed (no_report): the box ended and wrote no report, with exit code 1, after 726.0 s.",
      },
      {
        failure: { why: "bad_report", code: 0, ms: 3_100, tail: "" },
        words:
          "The run on the base failed (bad_report): the report the box wrote is not vitest's, with exit code 0, after 3.1 s.",
      },
    ])("names a `$failure.why` cause in words among its problems", ({ failure, words }) => {
      const { over } = drive({ drafts: [GOOD], run: "fail", failure });

      if (over.phase !== "over") {
        throw new Error("over");
      }

      expect(over.report.problems).toEqual([words]);
    });

    it("a bare `could_not_run` has no cause to put in words: its problems are empty", () => {
      const { over } = drive({ drafts: [GOOD], run: "fail" });

      if (over.phase !== "over") {
        throw new Error("over");
      }

      expect(over.report.problems).toEqual([]);
    });

    // A late answer, as after a restart that already moved on: only a run in flight is stopped by it.
    it("a failed run's answer outside `running` changes nothing and sends nothing", () => {
      type Msg = { readonly type: string; readonly [field: string]: unknown };
      const step = (s: TestWriter, m: Msg) => applyCell<TestWriter, Msg, TestWriterCmd>(testWriter, s, m);
      const late: Msg = {
        type: onBase.errType,
        cmd: onBase({ commit: COMMIT, tests: [] }),
        error: { _tag: "could_not_run", ...NO_REPORT },
      };
      const [reading] = step({ phase: "idle" }, { type: "start", ask: ASK, key: "k" });
      const { over } = drive({ drafts: [GOOD] });

      for (const s of [reading, over]) {
        expect(step(s, late)).toEqual([s, []]);
      }
    });
  });

  it("after a restart sends again what was in flight, the same write with the same intent", () => {
    for (const phase of ["reading", "committing", "running", "recording"] as const) {
      const { over, cmds } = drive({ drafts: [GOOD], restartAt: phase });
      expect(over).toMatchObject({ outcome: { kind: "done" } });
      const types = cmds.map((c) => c.type);
      expect(types.length).toBe(6);
      expect(new Set(cmds.map((c) => JSON.stringify(c))).size).toBe(5);
    }
  });

  it("starts the writer over once after a restart cuts it off, under a new name, and is stuck `cut_off` the second time", () => {
    const { over, prompts } = drive({ drafts: [GOOD], restartAt: "writing" });
    expect(over).toMatchObject({ outcome: { kind: "done" } });
    expect(prompts).toHaveLength(1);

    type Msg = { readonly type: string; readonly [field: string]: unknown };
    const step = (s: TestWriter, m: Msg) => applyCell<TestWriter, Msg, TestWriterCmd>(testWriter, s, m);
    const [reading, [taken]] = step({ phase: "idle" }, { type: "start", ask: ASK, key: "k" });
    const [first] = step(reading, { type: readTaken.okType, cmd: taken, value: [] });
    const [again] = step(first, { type: "resume" });
    expect([runSub.deps(first)?.key, runSub.deps(again)?.key]).toEqual(["k", "k/again/1"]);
    expect(step(again, { type: "resume" })[0]).toMatchObject({
      phase: "over",
      outcome: { kind: "stuck", why: "cut_off" },
    });
  });
});
