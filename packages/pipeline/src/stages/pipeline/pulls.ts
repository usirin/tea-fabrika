import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Context, Effect, FileSystem, Layer, Path, Schema, Stream} from "effect";
import {Ledger} from "../../asks/ledger.ts";
import {bookTarget, type LocalCheck, localCodeHost} from "../../code-host-local.ts";
import {CriteriaRecord, ledgerRecord} from "../../criteria/record.ts";
import {planOf, readTicketId, type TicketId} from "../../ids.ts";
import {CodeHost, CodeHostWrites} from "../../services.ts";
import type {PrFact} from "../../tickets/ticket.ts";
import {Tickets, Watcher} from "../../tickets/tickets.ts";
import type {TextKind} from "../review/pack.ts";
import {type PrFacts, ReviewKind} from "../ship/facts.ts";
import {LaneWork} from "./work.ts";

// The lane's pull requests on a local code host: a file of them beside a bare remote. Today's
// version, for proof with nothing real touched. `ship` runs on it unchanged, guards and all.
//
//   open    a row in `work/pulls.json`: which branch, which head, which tree
//   facts   approval is a person's `merge` answer on the ticket, and nothing else
//           checks are the repo's own `[[checks.run]]`, at this exact head
//   merge   `git push` of the head onto main, and only as a fast-forward: main moved answers `behind`
//
// The review reads before any of this exists: `<plan>/book` targets go to `localCodeHost` over the
// ticket's tree, at its local head. That is what lets the push step come after the review.
//
// The exam's pull request has no plan. Its one criterion is that a person read the rule changes
// and said yes, and its one row exists only once that answer is on the ticket, at that head.

type Failed = {readonly _tag: "unknown"};
const failed: Failed = {_tag: "unknown"};

/** How far past real ticket numbers an exam's own ticket id lies. */
const EXAM_FROM = 1_000_000;

export const Pull = Schema.Struct({
	id: Schema.String,
	kind: Schema.Literals(["lane", "exam"]),
	ticket: Schema.Finite,
	branch: Schema.String,
	head: Schema.String,
	tree: Schema.String,
	state: Schema.Literals(["open", "merged"]),
	title: Schema.String,
	body: Schema.String,
	verdicts: Schema.Array(
		Schema.Struct({kind: ReviewKind.fields.kind, verdict: Schema.Literals(["pass", "fail"])}),
	),
});
export type Pull = typeof Pull.Type;

const Pulls = Schema.fromJsonString(Schema.Array(Pull));

/**
 * What the code host itself is told about a pull request. `null` from `open`: it has none of its
 * own, so the row in the pulls file is the whole pull request.
 */
export class PullWire extends Context.Service<
	PullWire,
	{
		readonly open: (pull: {
			readonly branch: string;
			readonly title: string;
			readonly body: string;
		}) => Effect.Effect<string | null, Failed & {readonly says?: string}>;
		readonly post: (
			pr: string,
			head: string,
			posts: readonly {
				readonly kind: TextKind;
				readonly verdict: "pass" | "fail";
				readonly reason: string;
				readonly text: string;
			}[],
		) => Effect.Effect<void, Failed>;
		/** A merged pull request's branch off the host, where the host may lose it. */
		readonly gone: (pull: Pull) => Effect.Effect<void, Failed>;
	}
>()("PullWire") {}

/** A local host is told nothing but a merged branch's end: the row is all there is. */
export const localWire: Layer.Layer<PullWire, never, LaneWork> = Layer.effect(
	PullWire,
	Effect.gen(function* () {
		const work = yield* LaneWork;
		return {
			open: () => Effect.succeed(null),
			post: () => Effect.void,
			gone: (pull) => work.dropBranch(pull.branch).pipe(Effect.mapError(() => failed)),
		};
	}),
);

/** Is this the branch the lane itself named for this ticket? Only that one may ever be removed. Pure. */
export const ownBranch = (pull: Pull): boolean => pull.branch === `${pull.kind}/${pull.ticket}`;

/** The pulls file, and the local host over a tree. */
export class LanePulls extends Context.Service<
	LanePulls,
	{
		/** `id`: the code host's own name for it. Left out: the next local one. */
		readonly open: (
			pull: Omit<Pull, "id" | "state" | "verdicts">,
			id?: string,
		) => Effect.Effect<string, Failed>;
		/** The open pull request on this branch, if the lane has one. */
		readonly onBranch: (branch: string) => Effect.Effect<string | null>;
		readonly find: (id: string) => Effect.Effect<Pull, Failed>;
		readonly post: (
			id: string,
			head: string,
			verdicts: Pull["verdicts"],
		) => Effect.Effect<void, Failed>;
		readonly merged: (id: string) => Effect.Effect<void, Failed>;
		/** The pull requests of ticket `n` that merged. */
		readonly landed: (n: number) => Effect.Effect<readonly Pull[]>;
	}
>()("LanePulls") {}

export const lanePulls: Layer.Layer<LanePulls, never, LaneWork> = Layer.effect(
	LanePulls,
	Effect.gen(function* () {
		const work = yield* LaneWork;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const file = work.at("pulls.json");
		const all = fs.readFileString(file).pipe(
			Effect.flatMap(Schema.decodeEffect(Pulls)),
			Effect.orElseSucceed((): readonly Pull[] => []),
		);
		const save = (pulls: readonly Pull[]) =>
			Effect.gen(function* () {
				yield* fs.makeDirectory(path.dirname(file), {recursive: true});
				yield* fs.writeFileString(file, JSON.stringify(pulls, null, 1));
			}).pipe(Effect.mapError(() => failed));
		const change = (id: string, to: (pull: Pull) => Pull) =>
			Effect.flatMap(all, (pulls) => save(pulls.map((p) => (p.id === id ? to(p) : p))));
		return {
			open: (pull, known) =>
				Effect.gen(function* () {
					const pulls = yield* all;
					const open = pulls.find((p) => p.branch === pull.branch && p.state === "open");
					if (open !== undefined) {
						yield* change(open.id, (p) => ({
							...p,
							head: pull.head,
							title: pull.title,
							body: pull.body,
						}));
						return open.id;
					}
					const {repo} = yield* work.config;
					const id = known ?? `local:${repo}/pull/${pulls.length + 1}`;
					yield* save([...pulls, {...pull, id, state: "open", verdicts: []}]);
					return id;
				}),
			onBranch: (branch) =>
				Effect.map(
					all,
					(pulls) => pulls.find((p) => p.branch === branch && p.state === "open")?.id ?? null,
				),
			find: (id) =>
				Effect.flatMap(all, (pulls) => {
					const pull = pulls.find((p) => p.id === id);
					return pull === undefined ? Effect.fail(failed) : Effect.succeed(pull);
				}),
			post: (id, head, verdicts) => change(id, (p) => ({...p, head, verdicts})),
			merged: (id) => change(id, (p) => ({...p, state: "merged"})),
			landed: (n) =>
				Effect.map(all, (pulls) => pulls.filter((p) => p.ticket === n && p.state === "merged")),
		};
	}),
).pipe(Layer.provide(nodeServices));

/** The exam's own ticket id. Pure. */
export const examTicket = (repo: string, n: number): string => `${repo}#${n + EXAM_FROM}`;

const isExam = (id: TicketId): boolean => Number(id.slice(id.indexOf("#") + 1)) > EXAM_FROM;

/** Has a person said `merge` to the newest ask of this kind on the ticket? */
const said = (
	ticket: {
		readonly timeline: readonly {
			readonly by: {readonly kind: string};
			readonly fact: {readonly type: string; readonly ask?: string; readonly pick?: string};
		}[];
	},
	prefix: string,
): boolean => {
	const asks = ticket.timeline.flatMap((e) =>
		e.fact.type === "asked" && e.fact.ask?.startsWith(prefix) ? [e.fact.ask] : [],
	);
	const newest = asks.at(-1);
	return (
		newest !== undefined &&
		ticket.timeline.some(
			(e) =>
				e.by.kind === "user" &&
				e.fact.type === "answered" &&
				e.fact.ask === newest &&
				e.fact.pick === "merge",
		)
	);
};

const prefixOf = (pull: Pull) => (pull.kind === "exam" ? "a-exam_merge-" : "a-merge-");

/** Has a person said `merge` to the newest ask for this pull request? */
export const mergeAnswered = (ticket: Parameters<typeof said>[0], pull: Pull): boolean =>
	said(ticket, prefixOf(pull));

/** The reviews only the lane knows. No verdict posted yet is not known, and never passed. Pure. */
const reviewsFrom = (pull: Pull): PrFacts["reviews"] => {
	if (pull.kind === "exam") return [{kind: "governance", verdict: "passed"}];
	const row = ({kind, verdict}: Pull["verdicts"][number]): ReviewKind => ({
		kind,
		verdict: verdict === "pass" ? "passed" : "failed",
	});
	const [first, ...rest] = pull.verdicts;
	return first === undefined ? null : [row(first), ...rest.map(row)];
};

/**
 * What only the lane knows about a pull request, the same on every host. `yes`: a person said `merge`
 * to its newest ask. The exam's lands rules for the ticket, so only the lane's own finishes it, and a
 * person's answer is its one criterion. Pure.
 */
export const pullFacts = (
	pull: Pull,
	repo: string,
	yes: boolean,
): Pick<PrFacts, "ours" | "ticket" | "approval" | "reviews"> => ({
	ours: true,
	ticket:
		pull.kind === "exam"
			? {id: examTicket(repo, pull.ticket), link: "part_of_it"}
			: {id: `${repo}#${pull.ticket}`, link: "closes_it"},
	approval: yes ? "given" : "missing",
	reviews: reviewsFrom(pull),
});

/** Where a window links to a pull request: its own url, or one that says it is local. Pure. */
export const pullUrl = (pr: string): string =>
	pr.startsWith("https://") ? pr : `https://local.invalid/${pr.replace(/^local:/, "")}`;

/** A pull request's checks, in the one word a host reads them, as the fact spells a check. Pure. */
const checksFact = (word: PrFacts["checks"]): PrFact["checks"] => [
	word === "pending"
		? {name: "checks", status: "in_progress", conclusion: null}
		: {
				name: "checks",
				status: "completed",
				conclusion: word === "green" ? "success" : word === "red" ? "failure" : "stale",
			},
];

/**
 * The watcher. Today's version has no standing watcher anywhere, so the lane calls this right after
 * its push and its merge, through the watcher's own writer. `look`: a fact that holds only what the
 * code host read. `merged`: the one thing the lane may say itself, about its own merge, since a read
 * right after one can lag and would leave the ticket saying open. Either one that fails leaves a
 * comment on the ticket: the change is where it is whatever the window says.
 */
export class LaneWatch extends Context.Service<
	LaneWatch,
	{
		readonly look: (n: number, pr: string) => Effect.Effect<void>;
		readonly merged: (n: number, pr: string, head: string) => Effect.Effect<void>;
	}
>()("LaneWatch") {}

export const laneWatch: Layer.Layer<LaneWatch, never, CodeHost | Watcher | Tickets> = Layer.effect(
	LaneWatch,
	Effect.gen(function* () {
		const host = yield* CodeHost;
		const watcher = yield* Watcher;
		const tickets = yield* Tickets;
		const shown = (n: number, pr: string, facts: Pick<PrFacts, "state" | "head" | "checks">) =>
			watcher.write(n, `watch-${facts.state}-${facts.head}`, {
				type: "pr",
				url: pullUrl(pr),
				state: facts.state,
				head: facts.head,
				checks: checksFact(facts.checks),
			});
		const orSaid = <E>(n: number, pr: string, write: Effect.Effect<unknown, E>) =>
			write.pipe(
				Effect.catch(() =>
					tickets.talk(n, `watch-failed-${pr}`, {
						type: "commented",
						body: `Could not read ${pr} to show it here.`,
					}),
				),
				Effect.ignore,
			);
		return {
			look: (n, pr) =>
				orSaid(
					n,
					pr,
					Effect.flatMap(host.prFacts(pr), (facts) => shown(n, pr, facts)),
				),
			// Only a green head reaches a merge.
			merged: (n, pr, head) =>
				orSaid(n, pr, shown(n, pr, {state: "merged", head, checks: "green"})),
		};
	}),
);

/** The lane's `CodeHost` and `CodeHostWrites`, on a local host. `checks`: the repo's own. */
export const laneLocalHost = (
	checksOf: Effect.Effect<readonly LocalCheck[], Failed, LaneWork>,
): Layer.Layer<CodeHost | CodeHostWrites, never, LaneWork | LanePulls | Tickets | Ledger> => {
	const hosts = new Map<string, ReturnType<typeof localCodeHost>>();
	return Layer.effectContext(
		Effect.gen(function* () {
			const work = yield* LaneWork;
			const pulls = yield* LanePulls;
			const tickets = yield* Tickets;
			const ledger = yield* Ledger;
			const localFor = (tree: string) =>
				Effect.gen(function* () {
					const known = hosts.get(tree);
					if (known !== undefined) return known;
					const [first, ...rest] = yield* Effect.provideService(checksOf, LaneWork, work);
					// A review with no checks would pass on no check: the file has to name one.
					if (first === undefined) return yield* Effect.fail(failed);
					const made = localCodeHost({repo: tree, base: "origin/main", checks: [first, ...rest]});
					hosts.set(tree, made);
					return made;
				});
			const onLocal = <A, E>(
				tree: string,
				use: (host: CodeHost["Service"]) => Effect.Effect<A, E>,
			): Effect.Effect<A, E | Failed> =>
				Effect.gen(function* () {
					const made = yield* localFor(tree);
					const host = yield* Effect.provide(
						Effect.gen(function* () {
							return yield* CodeHost;
						}),
						Layer.provide(made.layer, Layer.succeed(Ledger, ledger)),
					);
					return yield* use(host);
				});
			const treeOfTarget = (target: string) =>
				Effect.map(work.tree(Number(/#(\d+)\/book$/.exec(target)?.[1])), (t) => t.tree);

			const host: CodeHost["Service"] = {
				change: (target, head) =>
					Effect.flatMap(treeOfTarget(target), (tree) =>
						onLocal(tree, (local) => local.change(target, head)),
					),
				checksSettled: (target, head, after) =>
					Stream.unwrap(
						(target.endsWith("/book")
							? treeOfTarget(target)
							: Effect.map(pulls.find(target), (p) => p.tree)
						).pipe(
							Effect.flatMap((tree) =>
								onLocal(tree, (local) => Effect.succeed(local.checksSettled(target, head, after))),
							),
							Effect.orElseSucceed(() => Stream.empty as Stream.Stream<void>),
						),
					),
				prFacts: (pr) =>
					Effect.gen(function* () {
						const pull = yield* pulls.find(pr);
						const ticket = yield* tickets.read(pull.ticket).pipe(Effect.mapError(() => failed));
						const {repo} = yield* work.config;
						const tip = yield* work.main;
						const target = bookTarget(planOf(readTicketId(`${repo}#${pull.ticket}`) as TicketId));
						const checks = yield* onLocal(pull.tree, (local) =>
							local.change(target, pull.head).pipe(Effect.map((c) => c.checks.state)),
						).pipe(Effect.orElseSucceed(() => "pending" as const));
						return {
							head: pull.head,
							state: pull.state,
							...pullFacts(pull, repo, mergeAnswered(ticket, pull)),
							checks: checks === "unknown" ? ("stuck" as const) : checks,
							mergeable: yield* work.mergeable(pull.head),
							comments: [],
							main: {tested: yield* work.mergeBase(tip, pull.head), tip},
						};
					}),
				leftQueue: () => Stream.never,
				pullRequests: () => Effect.succeed([]),
			};

			const writes: CodeHostWrites["Service"] = {
				enqueue: () => Effect.succeed("no_queue" as const),
				merge: (ready) =>
					Effect.gen(function* () {
						const pull = yield* pulls.find(ready.pr);
						if (pull.head !== ready.head) return {reading: "head_moved" as const};
						const landed = yield* work.land(ready.head);
						if (landed === "moved") return {reading: "behind" as const};
						yield* pulls.merged(ready.pr);
						return {reading: "merged" as const, commit: ready.head};
					}),
				rerunChecks: () => Effect.succeed([]),
			};
			return Context.add(Context.make(CodeHost, host), CodeHostWrites, writes);
		}),
	);
};

/**
 * The record ship reads: the plan's book on the asks ledger, and for an exam's ticket the one
 * criterion a person's answer proves, at the head they said yes to.
 */
export const laneRecord: Layer.Layer<
	CriteriaRecord,
	never,
	Ledger | LanePulls | Tickets | LaneWork
> = Layer.effect(
	CriteriaRecord,
	Effect.gen(function* () {
		const real = yield* CriteriaRecord;
		const tickets = yield* Tickets;
		const work = yield* LaneWork;
		return {
			...real,
			read: (ticket: TicketId) =>
				isExam(ticket)
					? Effect.gen(function* () {
							const n = Number(ticket.slice(ticket.indexOf("#") + 1)) - EXAM_FROM;
							const read = yield* tickets.read(n).pipe(Effect.mapError(() => failed));
							const side = yield* work.side(`exam-${n}`);
							const head = yield* work.head(side.tree);
							const yes = said(read, "a-exam_merge-");
							const criterion = {
								id: "c1",
								version: 1,
								text: "A person read these rule changes and said yes.",
							} as never;
							return {
								criteria: [criterion] as never,
								verdicts: yes
									? ([
											{
												id: "v1",
												criterion: "c1",
												version: 1,
												head,
												grade: "pass",
												proof: `their answer on ticket ${n}`,
											},
										] as never)
									: [],
							};
						})
					: real.read(ticket),
		};
	}),
).pipe(Layer.provide(ledgerRecord));
