import { Schema } from "effect";

/** One kind of review a pull request needs, and how it stands at the head commit. The kinds are today's fabrika's. */
export const ReviewKind = Schema.Struct({
  kind: Schema.Literals(["review-code", "review-doc", "review-skill", "review-ui", "governance"]),
  /** `missing`: no verdict binds to this commit. */
  verdict: Schema.Literals(["passed", "failed", "missing"]),
});
export type ReviewKind = typeof ReviewKind.Type;

/** Everything the gate needs, read at one commit. */
export const ShipFacts = Schema.Struct({
  /** The commit about to land. */
  head: Schema.String,
  state: Schema.Literals(["open", "merged", "closed", "draft"]),
  /** Opened by one of the repo's own accounts. */
  ours: Schema.Boolean,
  /** "Fixes #N", "Part of #N", or no ticket named. */
  ticket: Schema.Literals(["closes_it", "part_of_it", "none"]),
  /** Protected files need an owner's approval of this commit. `unknown`: the reader could not tell; it never guesses `missing`. */
  approval: Schema.Literals(["not_needed", "given", "missing", "unknown"]),
  /**
   * Every review this pull request needs, at this commit: `passed` only when
   * each one passed. `unknown`: the reader could not tell which it needs; one
   * passing review is never taken for all of them.
   */
  reviews: Schema.Literals(["passed", "failed", "missing", "unknown"]),
  /** The detail behind `reviews`, for whoever is told to fix it. A reader makes both from one list, with `reviewsOf`. Empty when `unknown`. */
  reviewKinds: Schema.Array(ReviewKind),
  checks: Schema.Literals(["green", "red", "pending", "stuck"]),
  mergeable: Schema.Literals(["clean", "conflicts", "unknown"]),
  /** Unresolved only. */
  comments: Schema.Array(Schema.Struct({ id: Schema.String, by: Schema.Literals(["person", "bot"]) })),
});
export type ShipFacts = typeof ShipFacts.Type;

/** The reviews as one word: any that failed is `failed`, else any with no verdict is `missing`, else `passed`. */
export const reviewsOf = (kinds: readonly ReviewKind[]): "passed" | "failed" | "missing" =>
  kinds.some((k) => k.verdict === "failed") ? "failed" : kinds.some((k) => k.verdict === "missing") ? "missing" : "passed";
