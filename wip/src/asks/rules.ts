import {hasLine, type Line, linesOf} from "../stages/plan/lines.ts";
import type {Plan} from "../stages/plan/plan.ts";
import {type AnswerBody, type Approved, type Ask, KINDS, type Next} from "./ask.ts";
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
// The stall rule for a task (docs/direction/done-is-per-criterion.md):
//
//   a round that leaves the list no shorter than the round before is a stall;
//   one stall earns one more round; a second stall in a row asks the owner;
//   "keep going N" gives N rounds, counted from review facts after the answer;
//   when they are spent and the list is no shorter than at the answer, it asks
//   again; a list that got shorter goes back to the plain rule, no answer
//   needed; a list that reaches 0 is done.

interface PlanTrack {
	readonly plan: string;
	tickets: readonly string[];
	readonly versions: {readonly version: number; readonly data: Plan; readonly seq: number}[];
	approved: Approved | null;
	closed: string | null;
	/** Tasks the owner removed, by place from 1. */
	readonly removed: Set<number>;
	/** Criteria the owner said again, by line key: the new text. */
	readonly reworded: Map<string, string>;
}

interface TaskTrack {
	readonly open: number[];
	last: number | null;
	stalls: number;
	grant: {left: number; readonly open: number} | null;
	time: number;
}

/** Everything the facts say, as far as the owner's asks go. */
export interface Folded {
	readonly plans: ReadonlyMap<string, PlanTrack>;
	/** Every ask ever raised, by id. */
	readonly asks: ReadonlyMap<string, Ask>;
	/** The answer the core took for each answered ask. */
	readonly answered: ReadonlyMap<string, AnswerBody>;
	/** Plan asks a newer version of the plan replaced before they were answered. */
	readonly superseded: ReadonlySet<string>;
}

const planId = (plan: string, version: number) => `plan:${plan}@${version}`;
const stuckId = (plan: string, task: number, time: number) => `stuck:${plan}#${task}/${time}`;
const rulingId = (ticket: string) => `ruling:${ticket}`;

/** The plan a task works from: the version last approved, else the newest. */
const working = (track: PlanTrack): Plan | null =>
	track.approved?.data ?? track.versions.at(-1)?.data ?? null;

/** A task's criteria as lines, with the owner's rewords in place. */
function criteriaLines(track: PlanTrack, task: number): readonly Line[] {
	const plan = working(track);
	if (plan === null) return [];
	return linesOf(plan)
		.filter((line) => line.key.startsWith(`t${task}.`))
		.map((line) => ({key: line.key, text: track.reworded.get(line.key) ?? line.text}));
}

/** Fold the ledger into what the owner's asks need. Pure. */
export function foldLedger(entries: readonly Entry[]): Folded {
	const plans = new Map<string, PlanTrack>();
	const tasks = new Map<string, TaskTrack>();
	const asks = new Map<string, Ask>();
	const answered = new Map<string, AnswerBody>();
	const superseded = new Set<string>();
	const folded: Folded = {plans, asks, answered, superseded};

	const raise = (ask: Ask) => {
		if (!asks.has(ask.id)) asks.set(ask.id, ask);
	};

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
					reworded: new Map(),
				};
				plans.set(fact.plan, track);
				const before = track.versions.at(-1);
				if (before !== undefined) {
					const id = planId(fact.plan, before.version);
					if (!answered.has(id)) superseded.add(id);
				}
				const version = (before?.version ?? 0) + 1;
				track.versions.push({version, data: fact.data, seq});
				track.tickets = [...new Set([...track.tickets, ...fact.tickets])];
				track.closed = null;
				raise({
					id: planId(fact.plan, version),
					at: seq,
					for: "plan",
					plan: fact.plan,
					tickets: track.tickets,
					version,
					data: fact.data,
					since: track.approved,
					problems: fact.problems,
				});
				return;
			}
			case "reviewed": {
				const track = plans.get(fact.plan);
				if (track === undefined || track.closed !== null || track.removed.has(fact.task)) return;
				const key = `${fact.plan}#${fact.task}`;
				const task: TaskTrack = tasks.get(key) ?? {
					open: [],
					last: null,
					stalls: 0,
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
					task.stalls = 0;
					task.grant = null;
					raise({
						id: stuckId(fact.plan, fact.task, task.time),
						at: seq,
						for: "stuck",
						plan: fact.plan,
						task: fact.task,
						title: working(track)?.tasks[fact.task - 1]?.title ?? `task ${fact.task}`,
						criteria: criteriaLines(track, fact.task),
						open: [...task.open],
						why,
						time: task.time,
					});
				};
				const last = task.last;
				task.last = fact.open;
				if (fact.open === 0) {
					task.stalls = 0;
					task.grant = null;
					return;
				}
				if (task.grant !== null) {
					task.grant.left -= 1;
					if (task.grant.left > 0) return;
					if (fact.open < task.grant.open) {
						task.grant = null;
						task.stalls = 0;
						return;
					}
					stuck("ran_out");
					return;
				}
				task.stalls = last !== null && fact.open >= last ? task.stalls + 1 : 0;
				if (task.stalls >= 2) stuck("no_progress");
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
			case "answered": {
				const ask = asks.get(fact.id);
				if (ask === undefined || problemWith(folded, fact) !== null) return;
				answered.set(fact.id, fact.answer);
				const answer = fact.answer;
				if (ask.for === "plan") {
					const track = plans.get(ask.plan);
					if (track === undefined) return;
					if (answer.kind === "approve") track.approved = {version: ask.version, data: ask.data};
					if (answer.kind === "no") track.closed = answer.why;
					return;
				}
				if (ask.for === "stuck") {
					const track = plans.get(ask.plan);
					const task = tasks.get(`${ask.plan}#${ask.task}`);
					if (track === undefined || task === undefined) return;
					task.stalls = 0;
					if (answer.kind === "keep_going")
						task.grant = {left: answer.rounds, open: task.last ?? Number.POSITIVE_INFINITY};
					if (answer.kind === "remove") track.removed.add(ask.task);
					if (answer.kind === "reword") {
						track.reworded.set(answer.line, `When ${answer.when.trim()}, ${answer.result.trim()}`);
						// The list changed under the count: the next round starts it again.
						task.last = null;
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
		.filter((ask) => ask.for !== "stuck" || !state.plans.get(ask.plan)?.removed.has(ask.task))
		.sort((a, b) => a.at - b.at);

/** Why the core does not take `answer`, or `null`: it does. Pure. */
export function problemWith(
	state: Folded,
	answer: {readonly id: string; readonly answer: AnswerBody},
): string | null {
	const ask = state.asks.get(answer.id);
	if (ask === undefined) return "no ask has this id";
	if (state.answered.has(answer.id)) return "this ask is already answered";
	if (state.superseded.has(answer.id)) return "a newer version of this plan is waiting instead";
	const body = answer.answer;
	if (nextOf(ask, body) === null)
		return `a ${ask.for} ask takes ${KINDS[ask.for].join(", ")}, not ${body.kind}`;
	if (ask.for === "plan" && body.kind === "change" && !hasLine(ask.data, body.line))
		return `the plan has no line ${body.line}`;
	if (ask.for === "stuck" && body.kind === "reword") {
		const {line} = body;
		if (!ask.criteria.some((c) => c.key === line))
			return `task ${ask.task} has no criterion ${line}`;
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
			if (answer.kind === "remove") return {do: "remove_task", task: ask.task};
			if (answer.kind === "keep_going")
				return {do: "keep_going", task: ask.task, rounds: answer.rounds};
			if (answer.kind === "reword")
				return {
					do: "reopen",
					task: ask.task,
					line: answer.line,
					text: `When ${answer.when.trim()}, ${answer.result.trim()}`,
				};
			return null;
		case "ruling":
			return answer.kind === "rule"
				? {do: "ruled", record: answer.rule === "lasting", plan: answer.build}
				: null;
	}
}
