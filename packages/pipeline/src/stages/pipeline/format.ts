import { Effect } from "effect";
import { FILES, SETTINGS_FILE } from "../../settings.ts";
import { saidOf } from "../../tickets/ticket.ts";
import { Tickets } from "../../tickets/tickets.ts";
import { LaneWork } from "./work.ts";

// The exam's own format commit. Today's version. Self-fix PR 1.
//
// Code formats what an agent writes before it commits it, with the repository's `[format] run`
// (./tools.ts: the test writer's and the mutants' tests, and the builder's files). An exam file can
// still reach a build round unformatted: the formatter was named after it was written, as on ticket
// 117, or it failed then. The builder may not change an exam file, so a format slip there would fail
// the checks every round. So before each build round, and after the mutants' answers, which go to the
// review with no build round between, code formats the exam files and commits that on its own:
//
//   lane/1:  tests for ticket 1  ->  format the tests for ticket 1  ->  the builder's commit
//                                    ^ the round's base: the builder's diff never holds it

/** What the ticket says, once, when the repository names no formatter. */
export const NO_FORMATTER = `This repository names no formatter, so code commits what each agent writes as it wrote it. To name one: [format] run in ${SETTINGS_FILE}, with "${FILES}" for the files.`;

/**
 * The exam files as `tree`'s head holds them, through the repository's formatter, and a code commit of
 * what that changed, with nothing else in it. Read from the head, so a builder's change to one that
 * nothing kept is never formatted in. Answers the new head. `null`: no commit was made.
 *
 *   no formatter named   one line on the ticket, once, and nothing changes
 *   it failed            what it wrote is committed, and the ticket says what it said
 */
export const formatExam = (number: number, tree: string, exam: readonly string[]) =>
  formatAt(number, tree, exam, {
    what: "the tests",
    message: `format the tests for ticket ${number}`,
  });

/**
 * Files as `tree`'s head holds them, through the repository's formatter, and a code commit of what
 * that changed, named `message`, as `formatExam` does. `what`: the files, as the ticket names them.
 * The exam's rule files go through it too (self-fix PR 10).
 */
export const formatAt = (
  number: number,
  tree: string,
  exam: readonly string[],
  words: { readonly what: string; readonly message: string },
) =>
  Effect.gen(function* () {
    const work = yield* LaneWork;
    const tickets = yield* Tickets;

    if ((yield* work.settings).format === undefined) {
      yield* tickets.talk(number, "format-none", { type: "commented", body: NO_FORMATTER }).pipe(Effect.ignore);
      return null;
    }

    const head = yield* work.head(tree);
    const files = (yield* Effect.forEach(
      exam,
      (path) => Effect.map(work.show(head, path), (text) => (text === null ? [] : [{ path, text }])),
      { concurrency: 1 },
    )).flat();
    const paths = files.map((file) => file.path);
    yield* work.write(tree, files);
    const formatted = yield* work.format(tree, paths);

    if (formatted._tag === "failed") {
      yield* tickets
        .talk(number, `format-exam-failed/${head}`, {
          type: "commented",
          body: saidOf(
            `The formatter failed on ${words.what}, so what it could not format is kept as written. ${formatted.says}`,
          ),
        })
        .pipe(Effect.ignore);
    }

    const after = yield* work.commitOnly(tree, paths, words.message);
    return after === head ? null : after;
  });
