import { describe, expect, it } from "vitest";
import { type TestWriter, type TestWriterCmd, testWriter } from "../stages/test-writer/machine.ts";
import { explore, pathText, stepOf, type Update } from "./explore.ts";
import * as tw from "./test-writer.ts";

// The test writer's laws, each shown to catch a planted mistake.
// standard.test.ts checks that each holds on the real machine.

const caught = (update: Update<TestWriter, tw.AnyTestWriterMsg, TestWriterCmd>, depth: number) =>
  Object.fromEntries(
    explore({
      init: tw.testWriterInit,
      update,
      world: tw.testWriterWorld(),
      laws: tw.testWriterLaws(),
      depth,
    }).broken.map((b) => [b.law, pathText(b.path, tw.showTestWriterMsg)]),
  );

const lines = (...steps: string[]) => steps.map((line, i) => `${i + 1}. ${line}`).join("\n");

describe("the test writer's laws", () => {
  it("catch a surprise taken as done", () => {
    expect(caught(tw.doneWithSurprise, 4)).toMatchObject({
      "done only with a commit, every result recorded and read back, and nothing to ask": lines(
        "start",
        "tests_taken_ok",
        'run k/1: draft "tests nothing"',
      ),
    });
  });

  it("catch a writer Msg taken from a run not asked for", () => {
    expect(caught(tw.takesAnyRun, 4)).toMatchObject({
      "a writer Msg counts only for the run asked for": lines(
        "start",
        "tests_taken_ok",
        "restart, then resume",
        'run k/1: draft "good"',
      ),
    });
  });

  it("catch a commit of a draft the Check did not pass", () => {
    expect(caught(tw.commitsAnotherDraft, 4)).toMatchObject({
      "nothing is committed that the Check did not pass": lines("start", "tests_taken_ok", 'run k/1: draft "good"'),
    });
  });

  it("catch a dollar left out of the report", () => {
    expect(caught(tw.dropsAFailedSpend, 4)).toMatchObject({
      "every dollar the writer spent is in the report": lines("start", "tests_taken_ok", "run k/1 failed: boom"),
    });
  });

  // Tracker 193.
  it("catch a failed run that drops what the writer said no test can check", () => {
    expect(caught(tw.dropsTheCannotRows, 5)).toMatchObject({
      "a run that fails keeps every row the writer said no test can check": lines(
        "start",
        "tests_taken_ok",
        'run k/1: draft "tests one, cannot one"',
        "tests_commit_ok",
        "on base failed: no cause",
      ),
    });
  });

  it("catch a failed run that drops the cause it gave", () => {
    expect(caught(tw.dropsTheCause, 5)).toMatchObject({
      "a run that fails and says why keeps the cause, and one that says nothing keeps none": lines(
        "start",
        "tests_taken_ok",
        'run k/1: draft "good"',
        "tests_commit_ok",
        // A bare tag keeps no cause either way, so the first run the law can catch is one that gave a why.
        "on base failed: no_report",
      ),
    });
  });

  const update = stepOf<TestWriter, tw.AnyTestWriterMsg, TestWriterCmd>(testWriter);

  it("catch a failed run that keeps the writer running", () => {
    const keepsRunning: Update<TestWriter, tw.AnyTestWriterMsg, TestWriterCmd> = (s, m) =>
      m.type === "tests_on_base_err" ? [s, []] : update(s, m);
    expect(caught(keepsRunning, 5)).toMatchObject({
      "a run that fails and says why keeps the cause, and one that says nothing keeps none": lines(
        "start",
        "tests_taken_ok",
        'run k/1: draft "good"',
        "tests_commit_ok",
        "on base failed: no cause",
      ),
    });
  });

  it("catch a failed run that keeps the writer's row but names it as another surprise", () => {
    const renames: Update<TestWriter, tw.AnyTestWriterMsg, TestWriterCmd> = (s, m) => {
      const [next, cmds] = update(s, m);
      return m.type === "tests_on_base_err" && next.phase === "over"
        ? [
            {
              ...next,
              report: {
                ...next.report,
                found: next.report.found.map((f) => ({ ...f, for: "already_passes" as const })),
              },
            },
            cmds,
          ]
        : [next, cmds];
    };
    expect(caught(renames, 5)).toMatchObject({
      "a run that fails keeps every row the writer said no test can check": lines(
        "start",
        "tests_taken_ok",
        'run k/1: draft "tests one, cannot one"',
        "tests_commit_ok",
        "on base failed: no cause",
      ),
    });
  });
});
