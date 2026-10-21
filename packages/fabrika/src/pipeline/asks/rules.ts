import {
	apply,
	type Book,
	type CriteriaMsg,
	type Current,
	currentOf,
	EMPTY,
	withRound,
} from "../criteria/book.ts";
import {
	type AskId,
	askId,
	type CriterionId,
	type Owner,
	PLAN,
	type PlanId,
	type TaskId,
	type TicketId,
} from "../ids.ts";
import {withIds} from "../stages/plan/ids.ts";
import {criteriaIn, hasLine} from "../stages/plan/lines.ts";
import type {Plan} from "../stages/plan/plan.ts";
import {type Answer, type AnswerBody, type Approved, type Ask, KINDS, type Next} from "./ask.ts";
import type {Entry, Fact} from "./ledger.ts";

// What waits on the owner, worked out from the ledger's facts alone, as a
// pure fold: Elm's update, with the ledger as the list of Msgs. Nothing here
// knows who shows an ask or how an answer was typed.
//
//   const state = foldLedger(entries);
//   openAsks(state);                    // what waits on the owner, oldest first
//   problemWith(state, answer);         // null: the core takes it
//   nextOf(ask, answer);                // what the core does with it
//
// Each plan keeps a criteria book (../criteria/book.ts), and every task and
// criterion is named by the id the book gave it:
//
//   planned        each task and criterion gets its id (../stages/plan/ids.ts):
//                  one that names a live id keeps it, any other is new
//   approved       ids an earlier version had and this one left out are retired.
//                  Only then: an unapproved version can only add or reword, so
//                  it can only make a merge harder
//   reword         the owner says a criterion again, by id: a new version
//   check, no      the owner's note is a new criterion of the task
//   remove task    its criteria are retired with it
//   judged         a review's rows, by id and version, each filed under a verdict
//                  id; what it found that no criterion covers is a new criterion
//                  of the task (`withRound`)
//
// An ask's id says what it is about, so the same ask always has the same one:
//
//   plan:o/r#7@2           version 2 of the plan o/r#7
//   stuck:o/r#7/t1/1       the first time task t1 of it is stuck
//   ruling:o/r#9           the ticket o/r#9, to rule on
//   check:o/r#7/t1/2:ui    build 2 of task t1, raised by "ui"
//
// The stall rule for a task (docs/direction/done-is-per-criterion.md):
//
//   a round that leaves the list no shorter than the round before is a stall;
//   one stall earns one more round; a second stall in a row asks the owner;
//   so does a third round in a row that brings no new lowest count, so a list
//   going 1, 2, 1, 2 asks at round 4; after an ask both counts start over;
//   "keep going N" gives N rounds, counted from review facts after the answer;
//   when they are spent and the list is no shorter than at the answer, it asks
//   again; a list that got shorter goes back to the plain rule, no answer
//   needed; a list that reaches 0 is done.
//
// The plain rule (no "keep going" in force) is `stallStep`, the one copy: the
// operate loop reads it too (`asksOnStall`), so a loop stops to ask the owner
// at the round this fold raises its stuck ask, never before.
//
// A plan's lane counts one more list the same way, under `plan` in place of a
// task: what each of its last reviews over the whole book left open, and one
// for each ship run that did not merge. Its stuck ask names every criterion of
// the book, for a reword, and is no task to remove.

/**
 * Where the stall rule stands after a round that left work open. `null` in
 * its place: no round to count from, at the start, after a list at 0, or when
 * the list changed under the count.
 */
export interface Stall {
	/** How many the round left open. */
	readonly last: number;
	/** The fewest any round left open since the count started. */
	readonly lowest: number;
	/** Stalls in a row, up to this round. */
	readonly stalls: number;
	/** Rounds in a row, up to this round, that brought no new lowest. */
	readonly sinceLowest: number;
}

/** The second stall in a row asks the owner. */
const STALLS_TO_ASK = 2;
/** The third round in a row with no new lowest asks the owner: a list going 1, 2, 1, 2 never stalls twice in a row. */
const NO_NEW_LOWEST_TO_ASK = 3;

/** The count from one round alone: what it left open is the lowest, and nothing is in a row yet. */
const startAt = (open: number): Stall => ({last: open, lowest: open, stalls: 0, sinceLowest: 0});

/**
 * One round of the plain stall rule. A round that leaves the list no shorter
 * than the round before is a stall; one that leaves no fewer than the lowest
 * so far brings no new lowest. A list at 0 is done, and the count starts
 * fully over: the next round is a first round. `ask`: this round is the
 * second stall in a row, or the third round in a row with no new lowest, so
 * the owner is asked, and both counts start over from this round.
 */
export function stallStep(
	stall: Stall | null,
	open: number,
): {readonly stall: Stall | null; readonly ask: boolean} {
	if (open === 0) return {stall: null, ask: false};
	if (stall === null) return {stall: startAt(open), ask: false};
	const stalls = open >= stall.last ? stall.stalls + 1 : 0;
	const sinceLowest = open < stall.lowest ? 0 : stall.sinceLowest + 1;
	const ask = stalls >= STALLS_TO_ASK || sinceLowest >= NO_NEW_LOWEST_TO_ASK;
	if (ask) return {stall: startAt(open), ask};
	return {stall: {last: open, lowest: Math.min(open, stall.lowest), stalls, sinceLowest}, ask};
}

/** The plain stall rule over a task's rounds, each by how many it left open: the last round asks the owner. */
export function asksOnStall(opens: readonly number[]): boolean {
	let stall: Stall | null = null;
	let ask = false;
	for (const open of opens) ({stall, ask} = stallStep(stall, open));
	return ask;
}

interface PlanTrack {
	readonly plan: PlanId;
	tickets: readonly TicketId[];
	readonly versions: {
		readonly version: number;
		readonly data: Plan;
		readonly seq: number;
		/** The tickets this version was planned with. */
		readonly tickets: readonly TicketId[];
	}[];
	approved: Approved | null;
	closed: string | null;
	/** Tasks the owner removed. */
	readonly removed: Set<TaskId>;
	/** Every criterion the plan ever had, under its id: the one place ids come from. */
	book: Book;
	/** The ids any version of the plan has had. Approving a version retires those of them it left out. */
	readonly planned: Set<CriterionId>;
	/** Tickets sort folded in, in order. One no version of the plan names yet waits for the next. */
	readonly folds: TicketId[];
}

/** One build of one task, and what holds it. */
export interface BuildTrack {
	readonly plan: PlanId;
	readonly task: TaskId;
	readonly build: number;
	readonly changes: readonly string[];
	/** How many listeners it waits on. */
	readonly holds: number;
	/** The listeners that cleared it or raised a check on it. */
	readonly heard: Set<string>;
	shipped: boolean;
	/** The owner said no to a check of it: it never ships, the task is built again. */
	rejected: boolean;
}

interface TaskTrack {
	readonly open: number[];
	/** Where the plain stall rule stands. While a "keep going" is in force, each round starts it over. */
	stall: Stall | null;
	grant: {left: number; readonly open: number} | null;
	time: number;
}

/** Everything the facts say, as far as the owner's asks go. */
export interface Folded {
	readonly plans: ReadonlyMap<PlanId, PlanTrack>;
	/** Every ask ever raised, by id. */
	readonly asks: ReadonlyMap<AskId, Ask>;
	/** The answer the core took for each answered ask. */
	readonly answered: ReadonlyMap<AskId, AnswerBody>;
	/** Plan asks a newer version of the plan replaced before they were answered. */
	readonly superseded: ReadonlySet<AskId>;
	/** Every build, by `<plan>/<task>/<build>`. */
	readonly builds: ReadonlyMap<string, BuildTrack>;
}

const buildKey = (plan: PlanId, task: TaskId, build: number) => `${plan}/${task}/${build}`;
/** The ask to approve version `version` of `plan`. */
export const planAskId = (plan: PlanId, version: number): AskId => askId(`plan:${plan}@${version}`);
/** The ask a stuck task, or the whole plan's list, raises the `time`-th time it is stuck. */
export const stuckId = (plan: PlanId, task: Owner, time: number): AskId =>
	askId(`stuck:${plan}/${task}/${time}`);
/** The ask to rule on `ticket`. */
export const rulingId = (ticket: TicketId): AskId => askId(`ruling:${ticket}`);
/** The check `by` raised on build `build` of a task. */
export const checkId = (plan: PlanId, task: TaskId, build: number, by: string): AskId =>
	askId(`check:${buildKey(plan, task, build)}:${by}`);

/** The plan a task works from: the version last approved, else the newest. */
const working = (track: PlanTrack): Plan | null =>
	track.approved?.data ?? track.versions.at(-1)?.data ?? null;

const said = (when: string, result: string) => `When ${when.trim()}, ${result.trim()}`;

/** A task's criteria now, from the book: the plan's, the owner's rewords and added ones in place. */
const taskCriteria = (track: PlanTrack, task: TaskId): readonly Current[] =>
	currentOf(track.book).filter((c) => c.task === task);

/** The criteria a list stands on: a task's own, or for the whole plan's list, the whole book. */
const listCriteria = (track: PlanTrack, task: Owner): readonly Current[] =>
	task === PLAN ? currentOf(track.book) : taskCriteria(track, task);

/** A task's criteria now, each under its id and version. Pure. */
export const criteriaOf = (state: Folded, plan: PlanId, task: TaskId): readonly Current[] => {
	const track = state.plans.get(plan);
	return track === undefined ? [] : taskCriteria(track, task);
};

/** A plan's criteria book: every criterion under its id, its wordings and verdicts. `null`: no such plan. Pure. */
export const bookOf = (state: Folded, plan: PlanId): Book | null =>
	state.plans.get(plan)?.book ?? null;

/** The tickets folded into a plan that no version of it was planned with yet, in order. Pure. */
export const foldsOf = (state: Folded, plan: PlanId): readonly TicketId[] => {
	const track = state.plans.get(plan);
	return track === undefined
		? []
		: track.folds.filter((t) => !track.versions.some((v) => v.tickets.includes(t)));
};

/** A plan's newest version, under its number. `null`: no such plan. Pure. */
export const latestOf = (
	state: Folded,
	plan: PlanId,
): {readonly version: number; readonly data: Plan} | null =>
	state.plans.get(plan)?.versions.at(-1) ?? null;

/** The plan whose tickets name `ticket`. `null`: none. Pure. */
export function planFor(state: Folded, ticket: TicketId): PlanId | null {
	for (const [plan, track] of state.plans) if (track.tickets.includes(ticket)) return plan;
	return null;
}

/** A plan's first task, in the version it works from. `null`: no such plan, or it has no task. Pure. */
export const firstTaskOf = (state: Folded, plan: PlanId): TaskId | null => {
	const track = state.plans.get(plan);
	return (track === undefined ? null : working(track)?.tasks[0]?.id) ?? null;
};

/** Builds that wait on nothing: every listener that holds builds was heard, no check of it is open, the owner said no to none. */
export const readyBuilds = (state: Folded): readonly BuildTrack[] => {
	const open = new Set(openAsks(state).map((ask) => ask.id));
	return [...state.builds.values()].filter(
		(b) =>
			!b.shipped &&
			!b.rejected &&
			b.heard.size >= b.holds &&
			![...b.heard].some((by) => open.has(checkId(b.plan, b.task, b.build, by))),
	);
};

/** Fold the ledger into what the owner's asks need. Pure. */
export function foldLedger(entries: readonly Entry[]): Folded {
	const plans = new Map<PlanId, PlanTrack>();
	const tasks = new Map<string, TaskTrack>();
	const asks = new Map<AskId, Ask>();
	const answered = new Map<AskId, AnswerBody>();
	const superseded = new Set<AskId>();
	const builds = new Map<string, BuildTrack>();
	const folded: Folded = {plans, asks, answered, superseded, builds};

	const raise = (ask: Ask) => {
		if (!asks.has(ask.id)) asks.set(ask.id, ask);
	};
	const write = (track: PlanTrack, ...msgs: readonly CriteriaMsg[]) => {
		track.book = msgs.reduce(apply, track.book);
	};
	/** Retire every live criterion `keep` says no to. */
	const retire = (track: PlanTrack, keep: (c: Current) => boolean) =>
		write(
			track,
			...currentOf(track.book)
				.filter((c) => !keep(c))
				.map((c): CriteriaMsg => ({type: "removed", id: c.id})),
		);

	const step = (seq: number, fact: Fact) => {
		switch (fact.type) {
			case "planned": {
				const track: PlanTrack = plans.get(fact.plan) ?? {
					plan: fact.plan,
					tickets: fact.tickets,
					versions: [],
					approved: null,
					closed: null,
					removed: new Set(),
					book: EMPTY,
					planned: new Set(),
					folds: [],
				};
				plans.set(fact.plan, track);
				const before = track.versions.at(-1);
				if (before !== undefined) {
					const id = planAskId(fact.plan, before.version);
					if (!answered.has(id)) superseded.add(id);
				}
				const version = (before?.version ?? 0) + 1;
				const numbered = withIds(
					track.book,
					fact.data,
					track.versions.map((v) => v.data),
				);
				track.book = numbered.book;
				for (const c of criteriaIn(numbered.plan)) track.planned.add(c.id);
				track.versions.push({version, data: numbered.plan, seq, tickets: fact.tickets});
				track.tickets = [...new Set([...track.tickets, ...fact.tickets])];
				track.closed = null;
				raise({
					id: planAskId(fact.plan, version),
					at: seq,
					for: "plan",
					plan: fact.plan,
					tickets: track.tickets,
					version,
					data: numbered.plan,
					since: track.approved,
					problems: fact.problems,
				});
				return;
			}
			case "folded": {
				// A fold into a plan the ledger does not hold yet is kept for nothing: sort folds into
				// open plans only, and an open plan was planned first.
				const track = plans.get(fact.plan);
				if (track === undefined || track.folds.includes(fact.ticket)) return;
				track.folds.push(fact.ticket);
				track.tickets = [...new Set([...track.tickets, fact.ticket])];
				return;
			}
			case "judged": {
				const track = plans.get(fact.plan);
				if (track !== undefined) track.book = withRound(track.book, fact);
				return;
			}
			case "reviewed": {
				const track = plans.get(fact.plan);
				if (
					track === undefined ||
					track.closed !== null ||
					(fact.task !== PLAN && track.removed.has(fact.task))
				)
					return;
				const key = `${fact.plan}/${fact.task}`;
				const task: TaskTrack = tasks.get(key) ?? {
					open: [],
					stall: null,
					grant: null,
					time: 0,
				};
				tasks.set(key, task);
				task.open.push(fact.open);
				// Rounds while the owner has not answered are kept, and not counted for anything.
				const waiting = [...asks.values()].some(
					(a) =>
						a.for === "stuck" &&
						a.plan === fact.plan &&
						a.task === fact.task &&
						!answered.has(a.id),
				);
				if (waiting) return;
				const stuck = (why: "no_progress" | "ran_out") => {
					task.time += 1;
					task.grant = null;
					raise({
						id: stuckId(fact.plan, fact.task, task.time),
						at: seq,
						for: "stuck",
						plan: fact.plan,
						task: fact.task,
						title:
							fact.task === PLAN
								? (working(track)?.summary ?? "the whole plan")
								: (working(track)?.tasks.find((t) => t.id === fact.task)?.title ??
									`task ${fact.task}`),
						criteria: listCriteria(track, fact.task).map(({id, version, text}) => ({
							id,
							version,
							text,
						})),
						open: [...task.open],
						why,
						time: task.time,
					});
				};
				// A list at 0 is done, and so is any "keep going".
				if (fact.open === 0) task.grant = null;
				if (task.grant !== null) {
					// The plain rule is not in force: it starts over at each round, so when the
					// grant ends it counts from the last one.
					task.stall = stallStep(null, fact.open).stall;
					task.grant.left -= 1;
					if (task.grant.left > 0) return;
					if (fact.open < task.grant.open) {
						task.grant = null;
						return;
					}
					stuck("ran_out");
					return;
				}
				const step = stallStep(task.stall, fact.open);
				task.stall = step.stall;
				if (step.ask) stuck("no_progress");
				return;
			}
			case "ruling_needed":
				raise({
					id: rulingId(fact.ticket),
					at: seq,
					for: "ruling",
					ticket: fact.ticket,
					ask: fact.ask,
					options: fact.options,
					why: fact.why,
				});
				return;
			case "built": {
				const build =
					[...builds.values()].filter((b) => b.plan === fact.plan && b.task === fact.task).length +
					1;
				builds.set(buildKey(fact.plan, fact.task, build), {
					plan: fact.plan,
					task: fact.task,
					build,
					changes: fact.changes,
					holds: fact.holds,
					heard: new Set(),
					shipped: false,
					rejected: false,
				});
				return;
			}
			case "cleared":
				builds.get(buildKey(fact.plan, fact.task, fact.build))?.heard.add(fact.by);
				return;
			case "check_raised": {
				const build = builds.get(buildKey(fact.plan, fact.task, fact.build));
				if (build === undefined || build.shipped) return;
				build.heard.add(fact.by);
				raise({
					id: checkId(fact.plan, fact.task, fact.build, fact.by),
					at: seq,
					for: "check",
					plan: fact.plan,
					task: fact.task,
					build: fact.build,
					by: fact.by,
					question: fact.question,
					attachments: fact.attachments,
				});
				return;
			}
			case "shipped": {
				const build = builds.get(buildKey(fact.plan, fact.task, fact.build));
				if (build !== undefined) build.shipped = true;
				return;
			}
			// Who works a ticket is the ledger's lease on it (./claims.ts); nothing waits on the owner for it.
			case "lane":
			case "released":
				return;
			case "answered": {
				const ask = asks.get(fact.id);
				if (ask === undefined || problemWith(folded, fact) !== null) return;
				answered.set(fact.id, fact.answer);
				const answer = fact.answer;
				if (ask.for === "check") {
					const build = builds.get(buildKey(ask.plan, ask.task, ask.build));
					const track = plans.get(ask.plan);
					if (answer.kind !== "no" || build === undefined) return;
					build.rejected = true;
					if (track !== undefined)
						write(track, {type: "added", task: ask.task, text: answer.why.trim(), by: "owner"});
					return;
				}
				if (ask.for === "plan") {
					const track = plans.get(ask.plan);
					if (track === undefined) return;
					if (answer.kind === "approve") {
						track.approved = {version: ask.version, data: ask.data};
						const kept = new Set(criteriaIn(ask.data).map((c) => c.id));
						retire(track, (c) => kept.has(c.id) || !track.planned.has(c.id));
					}
					if (answer.kind === "no") track.closed = answer.why;
					return;
				}
				if (ask.for === "stuck") {
					const track = plans.get(ask.plan);
					const task = tasks.get(`${ask.plan}/${ask.task}`);
					if (track === undefined || task === undefined) return;
					if (answer.kind === "keep_going")
						task.grant = {
							left: answer.rounds,
							open: task.stall?.last ?? Number.POSITIVE_INFINITY,
						};
					// The whole plan's list is no task: `problemWith` refuses a remove of it.
					if (answer.kind === "remove" && ask.task !== PLAN) {
						track.removed.add(ask.task);
						retire(track, (c) => c.task !== ask.task);
					}
					if (answer.kind === "reword") {
						write(track, {
							type: "reworded",
							id: answer.criterion,
							text: said(answer.when, answer.result),
							by: "owner",
						});
						// The list changed under the count: the next round starts it again.
						task.stall = null;
					}
				}
				return;
			}
		}
	};

	for (const entry of entries) step(entry.seq, entry.fact);
	return folded;
}

/** What waits on the owner: every ask raised, not answered and not replaced, oldest first. */
export const openAsks = (state: Folded): readonly Ask[] =>
	[...state.asks.values()]
		.filter((ask) => !state.answered.has(ask.id) && !state.superseded.has(ask.id))
		.filter(
			(ask) =>
				ask.for !== "stuck" ||
				ask.task === PLAN ||
				!state.plans.get(ask.plan)?.removed.has(ask.task),
		)
		.sort((a, b) => a.at - b.at);

/** Why the core does not take `answer`, or `null`: it does. Pure. */
export function problemWith(state: Folded, answer: Answer): string | null {
	const ask = state.asks.get(answer.id);
	if (ask === undefined) return "no ask has this id";
	if (state.answered.has(answer.id)) return "this ask is already answered";
	if (state.superseded.has(answer.id)) return "a newer version of this plan is waiting instead";
	const body = answer.answer;
	if (ask.for === "stuck" && ask.task === PLAN && body.kind === "remove")
		return "the whole plan's list is no task to remove: keep going, or reword a criterion";
	if (nextOf(ask, body) === null)
		return `a ${ask.for} ask takes ${KINDS[ask.for].join(", ")}, not ${body.kind}`;
	if (ask.for === "plan" && body.kind === "change" && !hasLine(ask.data, body.line))
		return `the plan has no line ${body.line}`;
	if (ask.for === "stuck" && body.kind === "reword") {
		const {criterion} = body;
		if (!ask.criteria.some((c) => c.id === criterion))
			return `task ${ask.task} has no criterion ${criterion}`;
	}
	return null;
}

/** What the core does with an answer. `null`: the answer is not one this kind of ask takes. Pure. */
export function nextOf(ask: Ask, answer: AnswerBody): Next | null {
	switch (ask.for) {
		case "plan":
			if (answer.kind === "approve") return {do: "build", version: ask.version};
			if (answer.kind === "change") return {do: "replan", line: answer.line, to: answer.to};
			if (answer.kind === "no") return {do: "close", why: answer.why};
			return null;
		case "stuck":
			if (answer.kind === "remove")
				return ask.task === PLAN ? null : {do: "remove_task", task: ask.task};
			if (answer.kind === "keep_going")
				return {do: "keep_going", task: ask.task, rounds: answer.rounds};
			if (answer.kind === "reword")
				return {
					do: "reopen",
					task: ask.task,
					criterion: answer.criterion,
					text: said(answer.when, answer.result),
				};
			return null;
		case "ruling":
			return answer.kind === "rule"
				? {do: "ruled", record: answer.rule === "lasting", plan: answer.build}
				: null;
		case "check":
			if (answer.kind === "yes") return {do: "ship", task: ask.task, build: ask.build};
			if (answer.kind === "no")
				return {do: "rebuild", task: ask.task, criterion: answer.why.trim()};
			return null;
	}
}
