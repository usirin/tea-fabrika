import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Context, Effect, Layer, Schema, Stream} from "effect";
import type {Ledger} from "../../asks/ledger.ts";
import {codeHostWritesOn} from "../../code-host-github-writes.ts";
import {answerOf, codeHostOn, prOf} from "../../code-host-github.ts";
import type {LocalCheck} from "../../code-host-local.ts";
import {CodeHost, CodeHostWrites} from "../../services.ts";
import {Tickets} from "../../tickets/tickets.ts";
import {ghOn, reviewWritesOn} from "../operate/writes.ts";
import type {PrFacts, ReviewKind} from "../ship/facts.ts";
import {laneLocalHost, LanePulls, mergeAnswered, type Pull, pullFacts, PullWire} from "./pulls.ts";
import {LaneWork} from "./work.ts";

// The lane's code host when `<home>/pipeline.json` says `github`. Today's version. It has run only
// over a stand-in `gh` (fixtures/pipeline-lane/gh.mjs), never against real GitHub. What differs from
// the local host:
//
//   before the push   the review reads the local head, on the local host, as it does there
//   after the push    pull request facts, the wait on its checks and the merge are GitHub's
//   the ticket        the row the lane kept, never what the pull request's text says: no issue is read
//   the verdicts      the ones the lane posted at this head, never GitHub's reviews or a reviewers list
//   the yes           a person's `merge` answer on the tracker ticket, not a GitHub approval
//   `[checks] github` read when a call needs it. Left out: `every`. `none`: the repo's own checks,
//                     on this machine, at the head the lane pushed, and GitHub's are never waited on
//   the row           merged once the lane's own merge says so, or a read of the facts does
//   opening           asks GitHub first: a kill can come after it opened one and before the row
//
// So a branch rule that wants a GitHub review still refuses the merge. Ship ends `stuck: merge_failed`
// and never reads the refusal's words, so the ticket does not say which rule refused it.

type Failed = {readonly _tag: "unknown"};
const failed: Failed = {_tag: "unknown"};

/** A verdict is for one head. On a head the lane did not post for, each row is `missing`. Pure. */
const notJudged = (rows: PrFacts["reviews"]): PrFacts["reviews"] => {
	if (rows === null) return null;
	const missing = (row: ReviewKind): ReviewKind => ({...row, verdict: "missing"});
	const [first, ...rest] = rows;
	return [missing(first), ...rest.map(missing)];
};

/** GitHub's reading, with what only the lane knows put over it. Pure. */
export const laneFactsOver = (facts: PrFacts, pull: Pull, repo: string, yes: boolean): PrFacts => {
	const own = pullFacts(pull, repo, yes);
	return {
		...facts,
		...own,
		reviews: facts.head === pull.head ? own.reviews : notJudged(own.reviews),
	};
};

/** The real arguments of the one `gh` line that opens a pull request. Pure. */
export const openArgs = (repo: string, pull: {branch: string; title: string; body: string}) => [
	"pr",
	"create",
	"--repo",
	repo,
	"--base",
	"main",
	"--head",
	pull.branch,
	"--title",
	pull.title,
	"--body",
	pull.body,
];

/**
 * The new pull request's url, from what `gh pr create` printed: its last line, whole, in this
 * repository. `null`: it printed anything else. Pure.
 */
export const createdUrl = (repo: string, out: string): string | null => {
	const last = out
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.at(-1);
	if (last === undefined || !last.startsWith("https://") || /\s/.test(last)) return null;
	const at = prOf(last);
	return at !== null && `${at.owner}/${at.name}` === repo ? last : null;
};

/** `--head` cannot name an owner, so a fork's pull request on a branch of this name is listed too. */
const OpenOnBranch = Schema.Array(
	Schema.Struct({url: Schema.String, isCrossRepository: Schema.Boolean}),
);

/** The real arguments of the `gh` line that finds the open pull request on a branch. Pure. */
const listArgs = (repo: string, branch: string) => [
	"pr",
	"list",
	"--repo",
	repo,
	"--head",
	branch,
	"--base",
	"main",
	"--state",
	"open",
	"--json",
	"url,isCrossRepository",
];

/** `CodeHost`, `CodeHostWrites` and `PullWire` on GitHub, through the person's own `gh`. */
export const laneGitHubHost = (
	repo: string,
	checksOf: Effect.Effect<readonly LocalCheck[], Failed, LaneWork>,
): Layer.Layer<
	CodeHost | CodeHostWrites | PullWire,
	never,
	LaneWork | LanePulls | Tickets | Ledger
> =>
	Layer.effectContext(
		Effect.gen(function* () {
			const gh = yield* ghOn;
			const work = yield* LaneWork;
			const pulls = yield* LanePulls;
			const tickets = yield* Tickets;
			const local = yield* CodeHost;
			const base = codeHostOn(gh, {own: [], reviewers: []});
			const writes = codeHostWritesOn(gh);
			// The file can change on main between two calls, so each call reads it.
			const counted = work.settings.pipe(
				Effect.map((settings) => settings.checks?.github ?? "every"),
				Effect.mapError(() => failed),
			);
			/** The repo's own checks, for `none`. They ran at the head the lane pushed, and at no other. */
			const ownChecks = (pr: string, pull: Pull, head: string) =>
				head === pull.head
					? Effect.map(local.prFacts(pr), (facts) => facts.checks)
					: Effect.succeed<PrFacts["checks"]>("pending");
			const host: CodeHost["Service"] = {
				...base,
				// The review comes before the push, so the one change the lane reads is a plan's book.
				change: (target, head) =>
					target.endsWith("/book") ? local.change(target, head) : Effect.fail(failed),
				checksSettled: (target, head, after) =>
					target.endsWith("/book")
						? local.checksSettled(target, head, after)
						: Stream.unwrap(
								// A file that does not read waits on GitHub, the safe side: the read after it stops the run.
								counted.pipe(
									Effect.match({
										onSuccess: (count) =>
											count === "none"
												? local.checksSettled(target, head, after)
												: base.checksSettled(target, head, after),
										onFailure: () => base.checksSettled(target, head, after),
									}),
								),
							),
				prFacts: (pr) =>
					Effect.gen(function* () {
						const facts = yield* base.prFacts(pr);
						const pull = yield* pulls.find(pr);
						// A merged row is not the branch's open pull request, so a new head there is a new one.
						if (facts.state === "merged" && pull.state === "open") yield* pulls.merged(pr);
						const ticket = yield* tickets.read(pull.ticket).pipe(Effect.mapError(() => failed));
						const over = laneFactsOver(facts, pull, repo, mergeAnswered(ticket, pull));
						return (yield* counted) === "none"
							? {...over, checks: yield* ownChecks(pr, pull, facts.head)}
							: over;
					}),
			};
			const review = reviewWritesOn(gh);
			const wire: PullWire["Service"] = {
				open: (pull) =>
					Effect.gen(function* () {
						// A kill after GitHub opened one and before the row was written: `gh pr create` refuses a
						// second, so the one already there is the one.
						const listed = yield* answerOf(gh, OpenOnBranch, listArgs(repo, pull.branch));
						const own = listed.find((open) => !open.isCrossRepository);
						if (own !== undefined) return own.url;
						const out = yield* gh(openArgs(repo, pull));
						const url = createdUrl(repo, out);
						if (url !== null) return url;
						return yield* Effect.fail({
							...failed,
							says: `gh pr create answered with no pull request in ${repo}: ${out.trim().slice(0, 200)}`,
						});
					}),
				post: (pr, head, posts) =>
					Effect.forEach(posts, (post) => review.post({pr, head, ...post}), {
						concurrency: 1,
						discard: true,
					}),
			};
			return Context.make(CodeHost, host).pipe(
				Context.add(CodeHostWrites, {
					...writes,
					// The lane knows it merged, whenever GitHub comes to mark it. A row that cannot be saved does
					// not undo the merge, so its failure is not the merge's.
					merge: (ready) =>
						writes
							.merge(ready)
							.pipe(
								Effect.tap((said) =>
									said.reading === "merged" ? Effect.ignore(pulls.merged(ready.pr)) : Effect.void,
								),
							),
					// GitHub's checks do not count under `none`, so there is nothing of theirs to run again.
					rerunChecks: (pr, head) =>
						Effect.flatMap(counted, (count) =>
							count === "none" ? Effect.succeed([]) : writes.rerunChecks(pr, head),
						),
				}),
				Context.add(PullWire, wire),
			);
		}).pipe(Effect.provide(laneLocalHost(checksOf)), Effect.provide(nodeServices)),
	);
