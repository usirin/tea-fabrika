import type {Entry} from "../../asks/ledger.ts";
import {type Folded, foldLedger, openAsks} from "../../asks/rules.ts";
import {taskId} from "../../ids.ts";
import {nameOf} from "../../stages/outcome.ts";
import {
	busy,
	deskOf,
	firstDesk,
	type Lane,
	type Lanes,
	type Note,
	planOfName,
	REAL,
	type Steps,
} from "./lanes.ts";
import type {Move, Safety, System} from "./search.ts";

// The laws across lanes, and one planted mistake for each.

type LanesLaw = Safety<Lanes, Note>;
const laneName = (i: number) => `L${i + 1}`;

/** A ticket is never worked by two lanes at once. */
export const oneLaneATicket: LanesLaw = {
	name: "a ticket is never worked by two lanes at once",
	check: (_prev, _move, next) => {
		for (let i = 0; i < next.lanes.length; i++)
			for (let j = i + 1; j < next.lanes.length; j++) {
				const a = next.lanes[i] as Lane;
				const b = next.lanes[j] as Lane;
				if (a.ticket === b.ticket && busy(a) && busy(b))
					return `${laneName(i)} and ${laneName(j)} both work ${a.ticket}`;
			}
		return null;
	},
};

/**
 * Nothing lands on a main it was not tested with. Two lanes that both merge
 * on top of the same main, neither catching up with the other, break it: the
 * second lands on a main that has the first in it, and nobody ran the two
 * together.
 */
export const testedWithMain: LanesLaw = {
	name: "nothing lands on a main it was not tested with",
	check: (_prev, move) => {
		for (const l of move.note?.landings ?? [])
			if (l.tested !== l.onto)
				return `${l.head} lands on main ${l.onto}, but it was built and tested on main ${l.tested}`;
		return null;
	},
};

/** Only a head a review passed lands. */
export const onlyPassedLands: LanesLaw = {
	name: "only a head a review passed lands",
	check: (_prev, move) => {
		for (const l of move.note?.landings ?? [])
			if (l.verdict !== "pass")
				return `${l.head} lands with ${l.verdict === null ? "no verdict" : `a ${l.verdict}`} at that head`;
		return null;
	},
};

/** The loop has its outcome: it is letting its ticket go, or over. */
const decided = (lane: Lane) => lane.loop.phase === "releasing" || lane.loop.phase === "over";

/**
 * A lane that stops to ask the owner leaves an ask on the owner's list: at
 * the step the loop takes its outcome, the review round that stopped it
 * raised a stuck ask. The owner may have answered it already (the loop posts
 * its verdicts between the review and its outcome); it was on the list.
 * Needs the desk on.
 */
export const asksReachTheOwner: LanesLaw = {
	name: "a lane that stops to ask the owner leaves an ask on the owner's list",
	check: (prev, _move, next) => {
		for (let i = 0; i < next.lanes.length; i++) {
			const was = prev.lanes[i] as Lane;
			const now = next.lanes[i] as Lane;
			if (decided(was) || !decided(now)) continue;
			if (now.loop.phase !== "releasing" && now.loop.phase !== "over") continue;
			if (now.loop.outcome.kind !== "ask") continue;
			const desk = (next.tickets[now.ticket] as {desk: readonly Entry[]}).desk;
			const plan = planOfName(now.ticket);
			const round = desk.findLast((e) => e.fact.type === "reviewed" && e.fact.plan === plan);
			const waiting = [...deskOf(desk).asks.values()].filter(
				(a) => a.for === "stuck" && a.plan === plan && a.at === round?.seq,
			);
			if (waiting.length === 0)
				return `${laneName(i)} stops to ask the owner (${nameOf(now.loop.outcome)}), but the owner's list has nothing for ${now.ticket}`;
		}
		return null;
	},
};

export const LANE_LAWS: readonly LanesLaw[] = [oneLaneATicket, testedWithMain, onlyPassedLands];

// ---------------------------------------------------------------- the desk alone

/**
 * The owner's desk on its own: review rounds tell it how many are open, in
 * any order of counts, and the owner answers what waits, or never does. One
 * plan, one task. `fold` is the asks core's fold, or a planted copy.
 */
export interface Desk {
	readonly desk: readonly Entry[];
	readonly rounds: number;
}

export interface DeskOptions {
	/** How many review rounds are told. */
	readonly rounds: number;
	/** The open counts a round may tell. */
	readonly counts: readonly number[];
	readonly fold?: (entries: readonly Entry[]) => Folded;
}

/** The one plan, written and approved, as a lane's desk starts. */
const PLANNED: readonly Entry[] = firstDesk("T1");
const PLAN = planOfName("T1");
const TASK = taskId("t1");

export function deskWorld(
	options: DeskOptions,
): System<Desk, {fold: (e: readonly Entry[]) => Folded}> {
	const fold = options.fold ?? foldLedger;
	const add = (w: Desk, fact: Entry["fact"], round: boolean): Desk => ({
		desk: [...w.desk, {seq: w.desk.length + 1, fact}],
		rounds: w.rounds + (round ? 1 : 0),
	});
	const note = {fold};
	return {
		init: {desk: PLANNED, rounds: 0},
		lanes: 1,
		moves: (w) => {
			const out: Move<Desk, typeof note>[] = [];
			if (w.rounds < options.rounds)
				for (const open of options.counts)
					out.push({
						label: `a review round leaves ${open} open`,
						lane: 0,
						touches: [],
						fair: "round",
						rare: false,
						next: add(w, {type: "reviewed", plan: PLAN, task: TASK, open}, true),
						note,
					});
			for (const ask of openAsks(fold(w.desk)))
				for (const answer of [{kind: "keep_going" as const, rounds: 1}, {kind: "remove" as const}])
					out.push({
						label: `the owner answers ${ask.id}: ${answer.kind}`,
						lane: 0,
						touches: [],
						fair: null,
						rare: false,
						next: add(w, {type: "answered", id: ask.id, answer}, false),
						note,
					});
			return out;
		},
		key: (w) => JSON.stringify(w.desk.slice(PLANNED.length).map((e) => e.fact)),
		canon: (w) => JSON.stringify(w.desk.slice(PLANNED.length).map((e) => e.fact)),
		mine: () => true,
		face: () => "",
		ended: (w) => w.rounds >= options.rounds,
	};
}

/** An ask leaves the owner's list only by an answer to it. */
export const askLeavesByAnAnswer: Safety<Desk, {fold: (e: readonly Entry[]) => Folded}> = {
	name: "an ask leaves the owner's list only by an answer to it",
	check: (prev, move, next) => {
		const fold = move.note?.fold ?? foldLedger;
		const after = new Set(openAsks(fold(next.desk)).map((a) => a.id));
		const told = next.desk.at(-1)?.fact;
		for (const ask of openAsks(fold(prev.desk)))
			if (!after.has(ask.id) && !(told?.type === "answered" && told.id === ask.id))
				return `${ask.id} left the owner's list with no answer to it`;
		return null;
	},
};

// ---------------------------------------------------------------- planted mistakes

const loopUpdate = REAL.loop;
const shipUpdate = REAL.ship;

/** Ship takes "you are in the queue" as "there is no queue": it merges straight in, past the queue. */
export const mergesPastTheQueue: Steps["ship"] = (s, m) =>
	m.type === "ship_enqueue_ok" && m.value === "queued"
		? shipUpdate(s, {...m, value: "no_queue"})
		: shipUpdate(s, m);

/**
 * Ship as it was before the waits were counted: each wait for the checks set
 * a clock, and nothing ended the run after a number of them. The real fix
 * (MAX_WAITS) counts in `waited`. The copy keeps `waited` at 1, so the waits
 * come round to the same state and the search can see the loop; before the
 * fix the count rose for ever, which a search of finite states never closes.
 */
export const waitsForEver: Steps["ship"] = (s, m) => {
	const [next, cmds] = shipUpdate(s, m);
	return next.phase === "waiting" ? [{...next, waited: 1}, cmds] : [next, cmds];
};

/** The loop takes a failed post of the verdicts as nothing, and waits on. */
export const ignoresAFailedPost: Steps["loop"] = (s, m) =>
	m.type === "loop_post_err" ? [s, []] : loopUpdate(s, m);

/**
 * The asks core, with a fold that drops a stuck ask once a later round shows
 * fewer open, as if the work had moved on, though nobody answered it.
 */
export function dropsAnAskOnProgress(entries: readonly Entry[]): Folded {
	const folded = foldLedger(entries);
	const asks = new Map(
		[...folded.asks].filter(([, ask]) => {
			if (ask.for !== "stuck") return true;
			const last = ask.open.at(-1) ?? 0;
			return !entries.some(
				(e) => e.seq > ask.at && e.fact.type === "reviewed" && e.fact.open < last,
			);
		}),
	);
	return {...folded, asks};
}
