import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Context, Effect, FileSystem, Layer, Option, Path, Schema, Stream} from "effect";
import {Ledger} from "../../asks/ledger.ts";
import {bookTarget, type LocalCheck, localCodeHost} from "../../code-host-local.ts";
import {Book, currentOf} from "../../criteria/book.ts";
import {CriteriaRecord, heldOf, keep, ledgerRecord} from "../../criteria/record.ts";
import {PLAN, planOf, readTicketId, type TicketId} from "../../ids.ts";
import {CodeHost, CodeHostWrites} from "../../services.ts";
import type {PrFact} from "../../tickets/ticket.ts";
import {Tickets, Watcher} from "../../tickets/tickets.ts";
import type {TextKind} from "../review/pack.ts";
import {type PrFacts, ReviewKind} from "../ship/facts.ts";
import type {Hop} from "../ship/ready.ts";
import {type Carried, carry, Given} from "./carry.ts";
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
// The exam's pull request (self-fix PR 10) has no plan of its own. Its criteria are code's, one per
// rule change (./exam-pull.ts), kept in its row's own book with the verdicts its review gave there.
// `<plan>/exam` targets go to `localCodeHost` over the exam's side tree.
//
// A yes binds to the diff, not the commit (./carry.ts). The verdicts posted at one head, and a
// person's `merge` said at one, count at a later head only when `carry` keeps them there, and each
// kept one writes a `carried` fact on the ticket.

type Failed = {readonly _tag: "unknown"};
const failed: Failed = {_tag: "unknown"};

const need = <A>(value: A | null): Effect.Effect<A, Failed> =>
	value === null ? Effect.fail(failed) : Effect.succeed(value);

/** The same verdicts, kind by kind, in the same order. Pure. */
const sameVerdicts = (a: Pull["verdicts"], b: Pull["verdicts"]): boolean =>
	a.length === b.length && a.every((v, i) => v.kind === b[i]?.kind && v.verdict === b[i]?.verdict);

/** A review's target that names an exam's pull request: `owner/repo#N/exam`. */
export const examTarget = (plan: string): string => `${plan}/exam`;
export const isExamTarget = (target: string): boolean => /#\d+\/exam$/.test(target);

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
	/** What the verdicts were given on: their head, its branch, where it left it, its diff's id. Left out: a row from before. */
	posted: Schema.optionalKey(Given),
	/** An exam's: its criteria, one per rule change, and the verdicts its review gave. Left out: a lane's, or a row from before. */
	book: Schema.optionalKey(Book),
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
		/** On a branch with an open one, its head and words move, and what it was judged on stays. */
		readonly open: (
			pull: Omit<Pull, "id" | "state" | "verdicts" | "posted">,
			id?: string,
		) => Effect.Effect<string, Failed>;
		/** The open pull request on this branch, if the lane has one. */
		readonly onBranch: (branch: string) => Effect.Effect<string | null>;
		readonly find: (id: string) => Effect.Effect<Pull, Failed>;
		/** The verdicts at `head`, and what they were given on there. */
		readonly post: (
			id: string,
			head: string,
			verdicts: Pull["verdicts"],
		) => Effect.Effect<void, Failed>;
		/** An exam's book, with a review's round kept in it. */
		readonly judged: (id: string, book: Book) => Effect.Effect<void, Failed>;
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
							...(pull.book === undefined ? {} : {book: keptBook(p.book, pull.book)}),
						}));
						return open.id;
					}

					const {repo} = yield* work.origin;
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
			// What they were given on is read now: `base` cannot be rebuilt later. A read that broke keeps
			// none, and then the verdicts count at this exact head only. The same verdicts posted again at a
			// head their diff was carried to (a push after main was merged in) keep what they judged.
			post: (id, head, verdicts) =>
				Effect.gen(function* () {
					const pull = (yield* all).find((p) => p.id === id);
					const was = sameVerdicts(pull?.verdicts ?? [], verdicts) ? pull?.posted : undefined;

					if (was !== undefined && was.head !== head) {
						const now = yield* work.now(was, head).pipe(Effect.option);

						if (Option.isSome(now) && carry(was, now.value)._tag === "kept") {
							return yield* change(id, (p) => ({...p, head, verdicts}));
						}
					}

					const given = yield* work.given(head, "main").pipe(Effect.option);
					yield* change(id, ({posted: _was, ...p}) => ({
						...p,
						head,
						verdicts,
						...(Option.isSome(given) ? {posted: given.value} : {}),
					}));
				}),
			judged: (id, book) => change(id, (p) => ({...p, book})),
			merged: (id) => change(id, (p) => ({...p, state: "merged"})),
			landed: (n) =>
				Effect.map(all, (pulls) => pulls.filter((p) => p.ticket === n && p.state === "merged")),
		};
	}),
).pipe(Layer.provide(nodeServices));

/**
 * The book an exam's row keeps when it lands again: the one it had, verdicts and all, while the
 * plan's words for its criteria are the same; else the new one. Pure.
 */
const keptBook = (had: Book | undefined, now: Book): Book => {
	const words = (book: Book) => JSON.stringify(currentOf(book).map(({id, text}) => [id, text]));
	return had !== undefined && words(had) === words(now) ? had : now;
};

/** The exam's own ticket id. Pure. */
export const examTicket = (repo: string, n: number): string => `${repo}#${n + EXAM_FROM}`;

const isExam = (id: TicketId): boolean => Number(id.slice(id.indexOf("#") + 1)) > EXAM_FROM;

/** A fact on a ticket, as far as a person's `merge` is read from it. */
interface Said {
	readonly type: string;
	readonly ask?: string;
	readonly pick?: string;
	readonly head?: string | null;
	readonly onto?: string;
	readonly base?: string | null;
	readonly diff?: string;
}

type Timeline = {
	readonly timeline: readonly {readonly by: {readonly kind: string}; readonly fact: Said}[];
};

/**
 * A person's `merge` to the newest ask for a pull request, and what it binds to:
 *
 *   none     nobody said it
 *   given    the answer keeps what they saw: the head, its branch, where it left it, its diff's id
 *   asked    only the ask keeps the head they were asked about
 *   unbound  neither keeps a head: said before self-fix PR 10, so it binds to the pull's head, as it did
 */
export type Yes =
	| {readonly _tag: "none"}
	| {readonly _tag: "given"; readonly given: Given}
	| {readonly _tag: "asked"; readonly head: string}
	| {readonly _tag: "unbound"};

const prefixOf = (pull: Pull) => (pull.kind === "exam" ? "a-exam_merge-" : "a-merge-");

/** A person's `merge` to the newest ask for this pull request, and what it binds to. Pure. */
export const yesOf = (ticket: Timeline, pull: Pull): Yes => {
	const prefix = prefixOf(pull);
	const asked = ticket.timeline.findLast(
		(e) => e.fact.type === "asked" && e.fact.ask?.startsWith(prefix) === true,
	)?.fact;
	const answer =
		asked?.ask === undefined
			? undefined
			: ticket.timeline.find(
					(e) =>
						e.by.kind === "user" &&
						e.fact.type === "answered" &&
						e.fact.ask === asked.ask &&
						e.fact.pick === "merge",
				)?.fact;

	if (answer === undefined) {
		return {_tag: "none"};
	}

	const {head, onto, base, diff} = answer;

	if (
		typeof head === "string" &&
		onto !== undefined &&
		typeof base === "string" &&
		diff !== undefined
	) {
		return {_tag: "given", given: {head, onto, base, diff}};
	}

	const at = head ?? asked?.head;
	return typeof at === "string" ? {_tag: "asked", head: at} : {_tag: "unbound"};
};

/** The reviews only the lane knows. No verdict posted yet is not known, and never passed. Pure. */
const reviewsFrom = (pull: Pull): PrFacts["reviews"] => {
	const row = ({kind, verdict}: Pull["verdicts"][number]): ReviewKind => ({
		kind,
		verdict: verdict === "pass" ? "passed" : "failed",
	});
	const [first, ...rest] = pull.verdicts;
	return first === undefined ? null : [row(first), ...rest.map(row)];
};

/** A verdict is for what it judged. Where that does not stand, each row is `missing`. Pure. */
const notJudged = (rows: PrFacts["reviews"]): PrFacts["reviews"] => {
	if (rows === null) {
		return null;
	}

	const missing = (row: ReviewKind): ReviewKind => ({...row, verdict: "missing"});
	const [first, ...rest] = rows;
	return [missing(first), ...rest.map(missing)];
};

/**
 * What only the lane knows about a pull request, the same on every host. `yes`: a person's `merge`
 * to its newest ask stands at the head. `judged`: what its verdicts judged stands there; left out, it
 * does. The exam's lands rules for the ticket, so only the lane's own finishes it. Pure.
 */
export const pullFacts = (
	pull: Pull,
	repo: string,
	yes: boolean,
	judged = true,
): Pick<PrFacts, "ours" | "ticket" | "approval" | "reviews"> => ({
	ours: true,
	ticket:
		pull.kind === "exam"
			? {id: examTicket(repo, pull.ticket), link: "part_of_it"}
			: {id: `${repo}#${pull.ticket}`, link: "closes_it"},
	approval: yes ? "given" : "missing",
	reviews: judged ? reviewsFrom(pull) : notJudged(reviewsFrom(pull)),
});

/**
 * Whether what was said on `given` stands at `head`, by `carry` over git, and the ticket's `carried`
 * fact for one that does at another head. A glance is a question of meaning nobody answered here, so
 * it stands no more than a stale one. A read that broke stands nothing.
 */
export const standsAt = (number: number, given: Given, head: string) =>
	carriedAt(number, given, head).pipe(Effect.map((carried) => carried._tag === "kept"));

/** What `carry` says of `given` at `head`, with the `carried` fact for a kept one. A read that broke is stale. */
export const carriedAt = (
	number: number,
	given: Given,
	head: string,
): Effect.Effect<Carried, never, LaneWork | Tickets> =>
	Effect.gen(function* () {
		if (given.head === head) {
			return {_tag: "kept", why: "same_head"} as const;
		}

		const work = yield* LaneWork;
		const tickets = yield* Tickets;
		const carried = carry(given, yield* work.now(given, head));

		if (carried._tag !== "kept") {
			return carried;
		}

		yield* tickets
			.write(number, `carried/${given.head}/${head}`, {
				type: "carried",
				from: given.head,
				to: head,
				why: carried.why,
			})
			.pipe(Effect.ignore);
		return carried;
	}).pipe(Effect.orElseSucceed((): Carried => ({_tag: "stale"})));

/** Whether a person's `merge` stands at `head`: as said, or carried there. */
export const yesAt = (number: number, yes: Yes, head: string) =>
	Effect.gen(function* () {
		switch (yes._tag) {
			case "none":
				return false;
			case "unbound":
				return true;
			case "given":
				return yield* standsAt(number, yes.given, head);
			case "asked":
				if (yes.head === head) {
					return true;
				}

				return yield* (yield* LaneWork).given(yes.head, "main").pipe(
					Effect.flatMap((given) => standsAt(number, given, head)),
					Effect.orElseSucceed(() => false),
				);
		}
	});

/**
 * Whether the verdicts posted on `pull` stand at `head`, and how. None: they do not. Some with no
 * hop: posted there. Some with one hop: carried there from the head they were posted at, which is
 * what ship's proof needs to count the criteria's rows kept at that head (../ship/ready.ts).
 */
export const judgedAt = (
	pull: Pull,
	head: string,
): Effect.Effect<Option.Option<readonly Hop[]>, never, LaneWork | Tickets> => {
	const posted = pull.posted;

	if (posted === undefined || posted.head === head) {
		return Effect.succeed(
			posted !== undefined || pull.head === head ? Option.some([]) : Option.none(),
		);
	}

	return standsAt(pull.ticket, posted, head).pipe(
		Effect.map((kept) => (kept ? Option.some([{from: posted.head, to: head}]) : Option.none())),
	);
};

/** The facts' `carried`, from how the verdicts stand: left out when no hop carried them. Pure. */
export const carriedOf = (judged: Option.Option<readonly Hop[]>): Pick<PrFacts, "carried"> => {
	const hops = Option.getOrElse(judged, () => []);
	return hops.length > 0 ? {carried: hops} : {};
};

/** An effect over the lane's work and tickets, with both given, as a host's call needs it. */
export const laneBound =
	(work: LaneWork["Service"], tickets: Tickets["Service"]) =>
	<A, E>(effect: Effect.Effect<A, E, LaneWork | Tickets>): Effect.Effect<A, E> =>
		effect.pipe(Effect.provideService(LaneWork, work), Effect.provideService(Tickets, tickets));

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
			const bound = laneBound(work, tickets);
			const localFor = (tree: string) =>
				Effect.gen(function* () {
					const known = hosts.get(tree);

					if (known !== undefined) {
						return known;
					}

					const [first, ...rest] = yield* Effect.provideService(checksOf, LaneWork, work);

					// A review with no checks would pass on no check: the file has to name one.
					if (first === undefined) {
						return yield* Effect.fail(failed);
					}

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
			/** The exam's side tree, for a `<plan>/exam` target, and its open pull's row. */
			const examOfTarget = (target: string) =>
				Effect.gen(function* () {
					const n = Number(/#(\d+)\/exam$/.exec(target)?.[1]);
					const side = yield* work.side(`exam-${n}`);
					const id = yield* pulls.onBranch(side.branch);
					const pull = id === null ? null : yield* pulls.find(id);
					return {n, tree: side.tree, pull};
				});
			/**
			 * The exam's pull request as a review reads it: the side tree's diff from main, as a plan's
			 * book reads, with the exam's own criteria and ticket. No book on its row: no criteria.
			 */
			const examChange = (target: string, head: string | null) =>
				Effect.gen(function* () {
					const {n, tree, pull} = yield* examOfTarget(target);
					const {repo} = yield* work.origin;
					const plan = planOf(yield* need(readTicketId(`${repo}#${n}`)));
					const change = yield* onLocal(tree, (local) => local.change(bookTarget(plan), head));
					return {
						...change,
						pr: target,
						ticket: {id: examTicket(repo, n), link: "part_of_it" as const},
						criteria:
							pull?.book === undefined
								? null
								: currentOf(pull.book).map(({id, version, text}) => ({
										id,
										version,
										text,
										checked: false,
										evidence: null,
									})),
					};
				});

			const host: CodeHost["Service"] = {
				change: (target, head) =>
					isExamTarget(target)
						? examChange(target, head)
						: Effect.flatMap(treeOfTarget(target), (tree) =>
								onLocal(tree, (local) => local.change(target, head)),
							),
				checksSettled: (target, head, after) =>
					Stream.unwrap(
						(target.endsWith("/book")
							? treeOfTarget(target)
							: isExamTarget(target)
								? Effect.map(examOfTarget(target), (exam) => exam.tree)
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
						const {repo} = yield* work.origin;
						const tip = yield* work.main;
						const plan = planOf(yield* need(readTicketId(`${repo}#${pull.ticket}`)));
						const checks = yield* onLocal(pull.tree, (local) =>
							local.change(bookTarget(plan), pull.head).pipe(Effect.map((c) => c.checks.state)),
						).pipe(Effect.orElseSucceed(() => "pending" as const));
						const yes = yield* bound(yesAt(pull.ticket, yesOf(ticket, pull), pull.head));
						const judged = yield* bound(judgedAt(pull, pull.head));
						return {
							head: pull.head,
							state: pull.state,
							...pullFacts(pull, repo, yes, Option.isSome(judged)),
							...carriedOf(judged),
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

						if (pull.head !== ready.head) {
							return {reading: "head_moved" as const};
						}

						const landed = yield* work.land(ready.head);

						if (landed === "moved") {
							return {reading: "behind" as const};
						}

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
 * The record ship reads: the plan's book on the asks ledger, and for an exam's ticket the book its
 * pull request's row keeps: the criteria code made from the plan's rule changes, and the verdicts
 * the exam's review gave (./exam-pull.ts). A row with no book holds no criteria.
 */
export const laneRecord: Layer.Layer<CriteriaRecord, never, Ledger | LanePulls | LaneWork> =
	Layer.effect(
		CriteriaRecord,
		Effect.gen(function* () {
			const real = yield* CriteriaRecord;
			const work = yield* LaneWork;
			const pulls = yield* LanePulls;
			/** The exam's pull request of ticket `n`: the open one, else the last that landed. */
			const examPull = (ticket: TicketId) =>
				Effect.gen(function* () {
					const n = Number(ticket.slice(ticket.indexOf("#") + 1)) - EXAM_FROM;
					const side = yield* work.side(`exam-${n}`).pipe(Effect.mapError(() => failed));
					const open = yield* pulls.onBranch(side.branch);

					if (open !== null) {
						return yield* pulls.find(open);
					}

					const landed = (yield* pulls.landed(n)).filter((p) => p.kind === "exam").at(-1);
					return landed ?? null;
				});
			return {
				read: (ticket: TicketId) =>
					isExam(ticket)
						? Effect.map(examPull(ticket), (pull) =>
								pull?.book === undefined ? null : heldOf(pull.book),
							)
						: real.read(ticket),
				judged: (ticket, judgement) =>
					isExam(ticket)
						? Effect.gen(function* () {
								const pull = yield* examPull(ticket);

								if (pull?.book === undefined) {
									return;
								}

								yield* pulls.judged(pull.id, keep(pull.book, judgement, PLAN));
							})
						: real.judged(ticket, judgement),
			};
		}),
	).pipe(Layer.provide(ledgerRecord));
