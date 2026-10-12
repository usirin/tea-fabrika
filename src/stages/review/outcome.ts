import { Schema } from "effect";
import { type Name, outcomesOf } from "../outcome.ts";

// What the review stage hands back: one typed answer. The shape is the one
// every stage uses: five verbs (`../outcome.ts`,
// docs/direction/outcome-names.md). Only the words below are the review
// stage's own, and only the ones this piece can reach are listed.

const review = outcomesOf({
  /**
   * Every text review the change owes passed at `head`. `part`: the change
   * owes another kind of review too (governance, the rendered one), and this
   * stage does not do those.
   */
  done: { head: Schema.String },
  send: {
    /**
     * Back to the builder. `review_failed`: a criterion failed or a finding
     * is open. `checks_red`: a required check is red at the head, so no
     * reviewer was started. `no_ticket`: the pull request's text names no
     * ticket, so there is nothing to review it against.
     */
    builder: ["review_failed", "checks_red", "no_ticket"],
  },
  /** This piece asks nobody. */
  ask: {},
  /** Merged, closed or a draft: nothing here to review. Not read on a replay of an older head. */
  skip: ["merged", "closed", "draft"],
  /**
   * Stop, never guess. `read_failed`: the pull request could not be read at
   * all. The next six are one part of the pack each: the ticket could not be
   * read, it has no acceptance criteria, the diff or the files could not be
   * read whole, the kinds of review owed could not be worked out, a rubric
   * is not in the folder, the list of checks could not be read whole.
   * `draft_failed`: the reviewer broke, or what it handed back is not a form
   * that holds together. `unseen`: nothing failed, and a criterion could not
   * be seen, so it is neither a pass nor a fail.
   */
  stuck: ["read_failed", "ticket_unknown", "no_criteria", "diff_unknown", "kinds_unknown", "rubric_unknown", "checks_unknown", "draft_failed", "unseen"],
});

export const ReviewOutcome = review.schema;
export type ReviewOutcome = typeof ReviewOutcome.Type;

/** Every name a review outcome can print: `send:builder:checks_red`, `done:part`, and so on. A text that is not one does not compile. */
export type ReviewName = Name<ReviewOutcome>;
export const REVIEW_NAMES = review.names;
/** Whether a text read from outside (a log, a saved run) is a review outcome's name. */
export const isReviewName = review.isName;
