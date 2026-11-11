// pgrep.ts: what one `pgrep` run says, for drive's two process guards (the agent cap and the
// one-typecheck wait). Today's lead tooling, run on our own laptop; it is not product.
//
//   pgrepAnswer(0, "41\n57\n") // listed, count 2
//   pgrepAnswer(1, "")         // listed, count 0: nothing matched
//   pgrepAnswer(3, "")         // refused: the process list could not be read
//
// pgrep exits 0 when something matched and 1 when nothing did; any other exit, or none at all, is
// pgrep failing (2 bad usage, 3 a fatal error, -1 not found). A sandbox, a Codex box or Claude
// Code's, refuses the process list, so a guard there cannot see anything: it skips with one line
// saying so, and never reads "refused" as "none running" in silence or waits on it.

import { Schema } from "effect";

/** What a `pgrep` run says: how many processes matched, or that it could not list them. */
export const PgrepAnswer = Schema.TaggedUnion({
  listed: { count: Schema.Int },
  refused: {},
});
export type PgrepAnswer = typeof PgrepAnswer.Type;

/** What a `pgrep` run with this exit code and stdout says. */
export const pgrepAnswer = (code: number, out: string): PgrepAnswer =>
  code === 0 || code === 1
    ? PgrepAnswer.cases.listed.make({
        count: code === 1 ? 0 : out.split("\n").filter((line) => line.trim() !== "").length,
      })
    : PgrepAnswer.cases.refused.make({});

/** The one line a guard prints when it skips: which guard, and why it cannot run here. */
export const skipLine = (guard: string) =>
  `drive: pgrep cannot list processes here (a sandbox or a box), so the ${guard} is skipped`;
