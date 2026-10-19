import {Schema} from "effect";

/** One kind of review a pull request needs, and how it stands at the head commit. The kinds are today's fabrika's. */
export const ReviewKind = Schema.Struct({
	kind: Schema.Literals(["review-code", "review-doc", "review-skill", "review-ui", "governance"]),
	/** `missing`: no verdict binds to this commit. */
	verdict: Schema.Literals(["passed", "failed", "missing"]),
});
export type ReviewKind = typeof ReviewKind.Type;

/** One run of the checks that was started again: which run, and the try it was on when the re-run was asked. */
export const Rerun = Schema.Struct({run: Schema.Number, attempt: Schema.Number});
export type Rerun = typeof Rerun.Type;

/** How a merge of one head went, on a repository with no merge queue: merged, with the commit on the base branch, or not, and why. */
export const Merged = Schema.Union([
	Schema.Struct({reading: Schema.Literals(["merged"]), commit: Schema.String}),
	Schema.Struct({reading: Schema.Literals(["head_moved", "conflicts"])}),
]);
export type Merged = typeof Merged.Type;

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
	 * Every kind of review this pull request needs, each as it stands at this
	 * commit, and any other kind that failed here. There is no summary word
	 * beside the rows to disagree with them: the gate works the answer out from
	 * the rows (`reviewsOf`). At least one: a change always needs a review.
	 * `null`: the reader could not tell which it needs; one passing review is
	 * never taken for all of them.
	 */
	reviews: Schema.NullOr(Schema.NonEmptyArray(ReviewKind)),
	checks: Schema.Literals(["green", "red", "pending", "stuck"]),
	mergeable: Schema.Literals(["clean", "conflicts", "unknown"]),
	/** Unresolved only. */
	comments: Schema.Array(
		Schema.Struct({id: Schema.String, by: Schema.Literals(["person", "bot"])}),
	),
});
export type ShipFacts = typeof ShipFacts.Type;

/** How the reviews stand, in one word. */
export type Reviews = "passed" | "failed" | "missing" | "unknown";

/**
 * The reviews as one word, worked out from the rows each time it is asked:
 * any that failed is `failed`, else any with no verdict is `missing`, else
 * `passed`. No rows read: `unknown`.
 */
export const reviewsOf = (rows: ShipFacts["reviews"]): Reviews =>
	rows === null
		? "unknown"
		: rows.some((k) => k.verdict === "failed")
			? "failed"
			: rows.some((k) => k.verdict === "missing")
				? "missing"
				: "passed";
