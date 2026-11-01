import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Context, Effect, Layer, Stream} from "effect";
import type {Ledger} from "../../asks/ledger.ts";
import {codeHostWritesOn} from "../../code-host-github-writes.ts";
import {codeHostOn, readChange} from "../../code-host-github.ts";
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
				change: (target, head) =>
					target.endsWith("/book")
						? local.change(target, head)
						: Effect.gen(function* () {
								const count = yield* counted;
								if (count !== "none") return yield* readChange(gh, count)(target, head);
								const change = yield* readChange(gh, "every")(target, head);
								const checks = yield* ownChecks(target, yield* pulls.find(target), change.head);
								return {
									...change,
									checks: {state: checks === "stuck" ? "unknown" : checks, required: []},
								};
							}),
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
						const ticket = yield* tickets.read(pull.ticket).pipe(Effect.mapError(() => failed));
						const over = laneFactsOver(facts, pull, repo, mergeAnswered(ticket, pull));
						return (yield* counted) === "none"
							? {...over, checks: yield* ownChecks(pr, pull, facts.head)}
							: over;
					}),
			};
			const review = reviewWritesOn(gh);
			const wire: PullWire["Service"] = {
				open: (pull) => Effect.map(gh(openArgs(repo, pull)), (out) => out.trim()),
				post: (pr, head, posts) =>
					Effect.forEach(posts, (post) => review.post({pr, head, ...post}), {
						concurrency: 1,
						discard: true,
					}),
			};
			return Context.make(CodeHost, host).pipe(
				Context.add(CodeHostWrites, {
					...writes,
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
