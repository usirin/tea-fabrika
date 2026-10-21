import {Schema} from "effect";
import {Criterion, Row} from "./ready.ts";

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

/**
 * How a merge of one head went, on a repository with no merge queue: merged,
 * with the commit on the base branch, or not, and why. `behind`: the code
 * host refused because main moved on from the main the head was tested on,
 * between the door's read and the write.
 */
export const Merged = Schema.Union([
	Schema.Struct({reading: Schema.Literals(["merged"]), commit: Schema.String}),
	Schema.Struct({reading: Schema.Literals(["head_moved", "conflicts", "behind"])}),
]);
export type Merged = typeof Merged.Type;

/**
 * The ticket a pull request serves: the one its text names with a closing
 * word ("Fixes #N") or "Part of #N", as `owner/name#N`. `none`: it names none.
 */
export const Serves = Schema.Union([
	Schema.Literal("none"),
	Schema.Struct({id: Schema.String, link: Schema.Literals(["closes_it", "part_of_it"])}),
]);
export type Serves = typeof Serves.Type;

/**
 * The base branch, as two commits. `tested`: where the head left it (the
 * merge base), so the main the head was built and its checks ran on. `tip`:
 * where it is now. When they differ, main moved on since, and the head was
 * never tested with what landed in between: only a merge queue, which tests
 * it on top of the tip, may land it.
 */
export const Main = Schema.Struct({tested: Schema.String, tip: Schema.String});
export type Main = typeof Main.Type;

/** What the code host knows about a pull request, read at one commit (`CodeHost.prFacts`). */
export const PrFacts = Schema.Struct({
	/** The commit about to land. */
	head: Schema.String,
	state: Schema.Literals(["open", "merged", "closed", "draft"]),
	/** Opened by one of the repo's own accounts. */
	ours: Schema.Boolean,
	ticket: Serves,
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
	main: Main,
});
export type PrFacts = typeof PrFacts.Type;

/**
 * Everything the gate needs: the code host's facts at the head, and what the
 * ledger holds for the ticket the pull request serves (`CriteriaRecord`).
 */
export const ShipFacts = Schema.Struct({
	...PrFacts.fields,
	/**
	 * The ticket's criteria as the ledger holds them now, each under its id at
	 * its current version. `null`: no ticket, or the ledger holds none for it;
	 * a pull request with nothing to prove never merges.
	 */
	criteria: Schema.NullOr(Schema.NonEmptyArray(Criterion)),
	/** Every verdict row the ledger kept for those criteria, oldest first: any head, any version. */
	verdicts: Schema.Array(Row),
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
