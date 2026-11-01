import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Context, Effect, Layer} from "effect";
import type {Ledger} from "../../asks/ledger.ts";
import {codeHostWritesOn} from "../../code-host-github-writes.ts";
import {codeHostOn} from "../../code-host-github.ts";
import type {LocalCheck} from "../../code-host-local.ts";
import {CodeHost, CodeHostWrites} from "../../services.ts";
import {Tickets} from "../../tickets/tickets.ts";
import {ghOn, reviewWritesOn} from "../operate/writes.ts";
import type {PrFacts} from "../ship/facts.ts";
import {laneLocalHost, LanePulls, mergeAnswered, type Pull, PullWire} from "./pulls.ts";
import type {LaneWork} from "./work.ts";

// The lane's code host when `<home>/pipeline.json` says `github`. Today's version. Never run against
// real GitHub yet: the first live run is the first time. What differs from the local host:
//
//   before the push   the review reads the local head, on the local host, as it does there
//   after the push    pull request facts, its checks and the merge are GitHub's
//   the ticket        the row the lane kept, never what the pull request's text says: no issue is read
//   the yes           a person's `merge` answer on the tracker ticket, not a GitHub approval
//
// So a branch rule that wants a GitHub review still refuses the merge, and ship says so.

type Failed = {readonly _tag: "unknown"};

/** GitHub's reading, with what only the lane knows put over it. Pure. */
export const laneFactsOver = (facts: PrFacts, pull: Pull, repo: string, yes: boolean): PrFacts => ({
	...facts,
	ours: true,
	ticket: {id: `${repo}#${pull.ticket}`, link: "closes_it"},
	approval: yes ? "given" : "missing",
});

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
			const pulls = yield* LanePulls;
			const tickets = yield* Tickets;
			const local = yield* CodeHost;
			const base = codeHostOn(gh, {own: [], reviewers: []});
			const host: CodeHost["Service"] = {
				...base,
				change: (target, head) =>
					target.endsWith("/book") ? local.change(target, head) : base.change(target, head),
				checksSettled: (target, head, after) =>
					target.endsWith("/book")
						? local.checksSettled(target, head, after)
						: base.checksSettled(target, head, after),
				prFacts: (pr) =>
					Effect.gen(function* () {
						const facts = yield* base.prFacts(pr);
						const pull = yield* pulls.find(pr);
						const ticket = yield* tickets
							.read(pull.ticket)
							.pipe(Effect.mapError((): Failed => ({_tag: "unknown"})));
						return laneFactsOver(facts, pull, repo, mergeAnswered(ticket, pull));
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
				Context.add(CodeHostWrites, codeHostWritesOn(gh)),
				Context.add(PullWire, wire),
			);
		}).pipe(Effect.provide(laneLocalHost(checksOf)), Effect.provide(nodeServices)),
	);
