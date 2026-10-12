import type { Brief } from "./gate.ts";
import type { ReviewOutcome } from "./outcome.ts";
import type { TextKind } from "./pack.ts";
import type { Sheet } from "./sheet.ts";

// The Check after the reviewer: the verdict, worked out from the sheet. The
// agent never says pass or fail for a review. It grades rows and writes
// findings; these few lines do the rest, the same way every time.

/** `unseen`: nothing failed, and a criterion could not be seen. Neither a pass nor a fail. */
export type Verdict = "pass" | "fail" | "unseen";

/**
 * One kind's verdict. Fail if any row failed or any finding of that kind is
 * open. Otherwise pass, unless a row could not be seen, which is neither.
 *
 * A row belongs to no kind: a criterion is the ticket's, not a review's. So
 * a failed row fails every kind the change owes, and an unseen row holds
 * every kind back. A finding counts for its own kind only.
 */
export function verdictOf(sheet: Sheet, kind: TextKind): Verdict {
  const failed = sheet.rows.some((row) => row.grade === "fail") || sheet.findings.some((finding) => finding.kind === kind && finding.state === "open");
  if (failed) return "fail";
  return sheet.rows.some((row) => row.grade === "unseen") ? "unseen" : "pass";
}

export interface KindVerdict {
  readonly kind: TextKind;
  readonly verdict: Verdict;
}

/** The verdict of each kind, in the order the kinds are owed. */
export const verdictsOf = (kinds: readonly TextKind[], sheet: Sheet): readonly KindVerdict[] => kinds.map((kind) => ({ kind, verdict: verdictOf(sheet, kind) }));

/**
 * The stage's one outcome, from the verdicts. Any fail goes back to the
 * builder. With none, an unseen one stops: nobody is told "pass" on a
 * criterion nobody saw. All passed is done; in part when the change owes a
 * kind of review this stage does not do.
 */
export function outcomeOf(brief: Brief, verdicts: readonly KindVerdict[]): ReviewOutcome {
  if (verdicts.some((v) => v.verdict === "fail")) return { kind: "send", to: "builder", why: "review_failed" };
  if (verdicts.some((v) => v.verdict === "unseen")) return { kind: "stuck", why: "unseen" };
  return { kind: "done", part: brief.left.length > 0, head: brief.head };
}
