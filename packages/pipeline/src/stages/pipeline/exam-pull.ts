import { Effect } from "effect";
import type { Book } from "../../criteria/book.ts";
import { type CriterionId, criterionId, PLAN } from "../../ids.ts";
import { Tickets } from "../../tickets/tickets.ts";
import type { ExamAsk, ExamChange } from "../exam/machine.ts";
import { openItems } from "../operate/stop.ts";
import type { Reviewed } from "../review/program.ts";
import { formatAt } from "./format.ts";
import { LanePulls } from "./pulls.ts";
import { LaneWork, pushBranch } from "./work.ts";

// The exam's pull request, reviewed before a person is asked to merge it (self-fix PR 10, Part 2).
// Today's version.
//
//   exam  ->  exam_review  ->  ask: exam_merge  ->  exam_merge  ->  test_writer
//
//   The exam writer's rule changes go on a pull request of their own. Its criteria are made here, by
//   code, from the plan's `exam` list: one per change, in the plan's order, never by an agent.
//
//   examCriteria([{path: ".oxlintrc.json", change: "turn on no-floating-promises", why: "..."}])
//   // [{id: "e1", version: 1, text: "When a reviewer reads `.oxlintrc.json` on this pull request, ..."}]
//
//   exam_review is all code, then one agent (./program.ts):
//     examReady    the host's head, a fast-forward only; main merged in; the rule files formatted; pushed
//     checks       `[build] checks` at that head; red goes back to the exam writer with the names
//     review       the review stage on `<plan>/exam`, against these criteria, kept in the pull row's book

/** One of the exam pull request's criteria: the plan's words for one rule change. */
export interface ExamCriterion {
  readonly id: CriterionId;
  readonly version: number;
  readonly text: string;
}

/** The exam pull request's criteria, `e1` first, one per change the plan lists, each version 1. */
export const examCriteria = (changes: readonly ExamChange[]): readonly ExamCriterion[] =>
  changes.map((change, i) => ({
    id: criterionId(`e${i + 1}`),
    version: 1,
    text: `When a reviewer reads \`${change.path}\` on this pull request, it does this: ${change.change}, because ${change.why}`,
  }));

/**
 * The book the exam's pull row starts with: its criteria, the plan's own (`plan`, as no task holds
 * them), and no verdict yet. What its review finds that no criterion covers is added as `c1`, ... Pure.
 */
export const examBook = (changes: readonly ExamChange[]): Book => ({
  next: 1,
  live: examCriteria(changes).map(({ id, version, text }) => ({
    id,
    task: PLAN,
    wordings: [{ version, text, by: "plan" as const }],
  })),
  retired: [],
  verdicts: [],
});

/** What a review sent the exam's pull request back for, a line each, for the exam writer's redo. Pure. */
export const sentBack = (reviewed: Pick<Reviewed, "outcome" | "criteria">): readonly string[] =>
  openItems(reviewed).map((item) => [item.says, ...item.wants.map((wants) => `It wants: ${wants}`)].join(" "));

/**
 * What the exam writer's folder holds, for its brief's `folder` slot, which its first turn reads. Pure.
 *
 *   folderWords(undefined)                  // the first writing: main
 *   folderWords({head, why})                // a redo on the pull request's head, with its last changes
 *   folderWords({head, why, on: "main"})    // a redo on main, without them: write each change again
 */
export const folderWords = (redo: ExamAsk["redo"]): string =>
  redo === undefined
    ? "This is no redo. Your folder holds main."
    : redo.on === "main"
      ? "This is a redo on main. Main changed under the pull request, and it does not merge into it, so your folder holds main, without your last changes. Write each listed change again on main's version, and hand each listed file back whole again."
      : "This is a redo. Your folder holds the pull request's head, with your last changes in it. Fix what is listed here in the same files, and hand each listed file back whole again.";

/**
 * The exam's pull request made ready for its review, by code:
 *
 *   ready      at `head`: the host's head, main merged in, the rule files formatted, and pushed
 *   moved      the host's head is no fast-forward of the side tree's: someone rewrote the branch
 *   conflicts  main does not merge into it: these files are the exam writer's to redo
 */
export type Ready =
  | { readonly _tag: "ready"; readonly head: string }
  | { readonly _tag: "moved"; readonly ours: string; readonly theirs: string }
  | { readonly _tag: "conflicts"; readonly head: string; readonly files: readonly string[] };

/** Ticket `number`'s exam pull request `pr`, made ready for its review, with its rule files `rules`. */
export const examReady = (number: number, pr: string, rules: readonly string[]) =>
  Effect.gen(function* () {
    const work = yield* LaneWork;
    const pulls = yield* LanePulls;
    const name = `exam-${number}`;
    const side = yield* work.side(name);
    const ours = yield* work.head(side.tree);
    // A person may push to the exam branch, as on ticket 117: the side tree goes there first.
    const theirs = yield* work.remoteHead(side.branch);

    if (theirs !== null && theirs !== ours && (yield* work.sideTo(name, theirs)) === "behind") {
      return { _tag: "moved", ours, theirs } satisfies Ready;
    }

    const merged = yield* work.sideMerge(name);

    if (merged._tag === "conflicts") {
      return { _tag: "conflicts", head: theirs ?? ours, files: merged.files } satisfies Ready;
    }

    yield* formatAt(number, side.tree, rules, {
      what: "the rule changes",
      message: `format the rule changes for ticket ${number}`,
    });
    const head = yield* work.head(side.tree);

    if (head !== theirs) {
      yield* pushBranch({ work, tickets: yield* Tickets }, number, side.tree, head, side.branch);
      const { id: _id, state: _state, verdicts: _verdicts, posted: _posted, ...row } = yield* pulls.find(pr);
      yield* pulls.open({ ...row, head });
    }

    return { _tag: "ready", head } satisfies Ready;
  });
