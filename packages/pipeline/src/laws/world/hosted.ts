import {structuralHash} from "@demlik/tea";
import {planOf, taskId, ticketId} from "../../ids.ts";
import {
	type KidEnd,
	kidSub,
	type Lane,
	type LaneCmd,
	type LaneJob,
	notePlan,
	noteRound,
	openPr,
	readLane,
	startKid,
} from "../../stages/lane/machine.ts";
import type {LaneView} from "../../stages/lane/view.ts";
import {type AnyLaneMsg, laneStep} from "../lane.ts";
import type {Move, System} from "./search.ts";

// One hosted lane and a model of its host, for the world search (./search.ts) and its "eventually"
// laws (experiment 115).
//
// The lane is the real reducer (../../stages/lane/machine.ts, through `stepOf` in ../lane.ts). The
// rest is a model:
//
//   the host     starts the lane, and starts a child when the lane's `lane_start` is answered. When
//                a child's process ends, the host hands its parent an EXIT. That EXIT is guaranteed:
//                a fair move
//   a child      may write its outcome row, or not, and its process ends. Writing the row is not
//                guaranteed (a crash, a kill, a dollar cap hit, a defect before the write): it may
//                never happen. The process ending is fair
//   the ledger   one task, t1. Its review child writing `done` settles it; the lane's `lane_open`
//                opens the pull request; the ship child writing `done` merges it. A read sees that
//   the Sub      `lane_kid`, as ../../hosted/lane.ts wires it today (`today`): while the lane runs a
//                child it reads the child's outcome row, again and again, and ends only when the row
//                is there. The lane traps EXITs (`trapExit(true)`) and does nothing with them. The
//                `fixed` Sub also ends on the child's EXIT: a missing row is `stuck:no_outcome`.
//                The fixed one is a sketch for the experiment, not the code
//
// Left out: a restart of the lane, two lanes, the owner's asks, a plan child, a review that sends
// work back. Each is in ../lane.ts's one-machine world or experiment 91's.

/** How the lane's child Sub ends. `today`: only on the outcome row. `fixed`: also on the child's EXIT. */
export type SubWiring = "today" | "fixed";

/** What a child may write as its outcome row, by a short name. */
export const ROWS: Readonly<Record<string, KidEnd>> = {
	done: {outcome: {kind: "done"}, head: "H"},
	stuck: {outcome: {kind: "stuck", why: "draft_failed"}},
};

/** What the today Sub hands the lane for a row it cannot read, and the fixed Sub for no row. */
export const NO_OUTCOME: KidEnd = {outcome: {kind: "stuck", why: "no_outcome"}};

export interface HostedOptions {
	readonly sub: SubWiring;
	/** The rows a child may write, by name in `ROWS`. Default: every one. */
	readonly rows?: readonly string[];
	/** Each lane Cmd may also be refused. Default: no, each is answered ok. */
	readonly errors?: boolean;
	/**
	 * Every child writes its row before its process ends: the lane's own assumption, which the host
	 * does not give. Default: no, a child may end with no row.
	 */
	readonly always?: boolean;
}

/** One child, as the host sees it. */
export interface Kid {
	readonly name: string;
	/** Its process is still running. */
	readonly alive: boolean;
	/** Its outcome row. `null`: none written. */
	readonly row: KidEnd | null;
	/** The host has handed the lane this child's EXIT. */
	readonly told: boolean;
}

export interface Hosted {
	readonly booted: boolean;
	readonly lane: Lane;
	/** The lane's Cmds not answered yet. */
	readonly asked: readonly LaneCmd[];
	readonly kids: readonly Kid[];
	/** t1's review child wrote `done`. */
	readonly settled: boolean;
	readonly pr: "none" | "open" | "merged";
}

const TICKET = ticketId("o/r#7");
const PLAN_ID = planOf(TICKET);
const LANE = "lane:7";
const T1 = taskId("t1");
const JOB: LaneJob = {
	plan: PLAN_ID,
	settings: {model: "m", effort: "low", budget: 1},
	usd: 1,
	rubrics: "r",
	at: 0,
};
const UNKNOWN = {_tag: "unknown" as const};

/** The plan's view, as the ledger and the code host say now. Pure. */
export function viewOf(w: Hosted): LaneView {
	return {
		approved: true,
		closed: false,
		waiting: [],
		tasks: [{task: T1, settled: w.settled, open: []}],
		removed: [],
		planOpen: [],
		planTodo: [],
		head: "H",
		behind: false,
		met: w.settled,
		pr: w.pr === "none" ? null : {url: "P", state: w.pr, head: "H"},
		tickets: ["o/r#7"],
		version: 1,
		folds: [],
		title: "windows",
		summary: "Opens the windows.",
	};
}

/** Step the real lane with one Msg, and keep the Cmds it sends. */
const stepLane = (w: Hosted, msg: AnyLaneMsg): Hosted => {
	const [lane, cmds] = laneStep(w.lane, msg);
	return {...w, lane, asked: [...w.asked, ...cmds]};
};

const setKid = (w: Hosted, kid: Kid): Hosted => ({
	...w,
	kids: w.kids.map((k) => (k.name === kid.name ? kid : k)),
});

/** What a row written by a child changes in the ledger and the code host. */
const wrote = (w: Hosted, kid: string, row: KidEnd): Hosted => {
	if (row.outcome.kind !== "done") return w;
	if (kid === `${LANE}:t1:r1:review`) return {...w, settled: true};
	if (kid.endsWith(":ship")) return {...w, pr: "merged"};
	return w;
};

/** The answers a Cmd may get, each with what it changes in the world first. */
function answersOf(
	w: Hosted,
	cmd: LaneCmd,
	errors: boolean,
): readonly {readonly label: string; readonly before: Hosted; readonly msg: AnyLaneMsg}[] {
	switch (cmd.type) {
		case "lane_read":
			return [
				{label: "read", before: w, msg: readLane.ok(cmd, viewOf(w), 0)},
				...(errors ? [{label: "read refused", before: w, msg: readLane.err(cmd, UNKNOWN, 0)}] : []),
			];
		case "lane_start":
			return [
				{
					label: `${cmd.kid} started`,
					before: {...w, kids: [...w.kids, {name: cmd.kid, alive: true, row: null, told: false}]},
					msg: startKid.ok(cmd, {started: true}, 0),
				},
				...(errors
					? [{label: `${cmd.kid} not started`, before: w, msg: startKid.err(cmd, UNKNOWN, 0)}]
					: []),
			];
		case "lane_note":
			return [
				{label: "noted", before: w, msg: noteRound.ok(cmd, {}, 0)},
				...(errors
					? [{label: "note refused", before: w, msg: noteRound.err(cmd, UNKNOWN, 0)}]
					: []),
			];
		case "lane_open":
			return [
				{
					label: "pull request opened",
					before: {...w, pr: "open"},
					msg: openPr.ok(cmd, {url: "P"}, 0),
				},
				...(errors ? [{label: "open refused", before: w, msg: openPr.err(cmd, UNKNOWN, 0)}] : []),
			];
		case "lane_planned":
			return [{label: "planned", before: w, msg: notePlan.ok(cmd, {}, 0)}];
	}
}

/** Every move possible from a state. */
function movesOf(w: Hosted, o: HostedOptions): Move<Hosted>[] {
	const rows = (o.rows ?? Object.keys(ROWS)).flatMap((name) => {
		const row = ROWS[name];
		return row === undefined ? [] : [[name, row] as const];
	});
	const out: Move<Hosted>[] = [];
	const move = (label: string, fair: string | null, next: Hosted) =>
		out.push({label, lane: 0, touches: ["lane"], fair, rare: false, next});
	if (!w.booted) {
		move(
			"the host starts the lane",
			"boot",
			stepLane({...w, booted: true}, {type: "start", lane: LANE, job: JOB}),
		);
		return out;
	}
	// The lane's Cmds: each is answered in the end.
	for (const [i, cmd] of w.asked.entries()) {
		const rest = {...w, asked: w.asked.filter((_, j) => j !== i)};
		for (const a of answersOf(rest, cmd, o.errors ?? false))
			move(a.label, `answer ${cmd.type}`, stepLane(a.before, a.msg));
	}
	for (const kid of w.kids) {
		if (kid.alive) {
			// The row may never be written: no fairness. The process ending is fair.
			// Under `always`, the write is the fair move and the process ends only after it.
			if (kid.row === null)
				for (const [name, row] of rows)
					move(
						`${kid.name} writes its row: ${name}`,
						o.always ? `end ${kid.name}` : null,
						wrote(setKid(w, {...kid, row}), kid.name, row),
					);
			if (kid.row !== null || !o.always)
				move(
					kid.row === null ? `${kid.name} ends with no row` : `${kid.name} ends`,
					`end ${kid.name}`,
					setKid(w, {...kid, alive: false}),
				);
		} else if (!kid.told)
			// The host's EXIT to the parent. The lane traps it; today nothing reads it.
			move(
				`EXIT of ${kid.name} reaches the lane`,
				`exit ${kid.name}`,
				setKid(w, {...kid, told: true}),
			);
	}
	// The lane's child Sub, from the real machine's own deps.
	const deps = kidSub.deps(w.lane);
	if (deps !== null && deps !== undefined) {
		const kid = w.kids.find((k) => k.name === deps.kid);
		const row = kid?.row ?? null;
		const gone = o.sub === "fixed" && kid !== undefined && kid.told;
		if (row !== null)
			move(
				`the Sub reads ${deps.kid}'s row`,
				"sub",
				stepLane(w, {type: "kid_over", kid: deps.kid, end: row}),
			);
		else if (gone)
			move(
				`the Sub sees ${deps.kid} gone with no row: stuck:no_outcome`,
				"sub",
				stepLane(w, {type: "kid_over", kid: deps.kid, end: NO_OUTCOME}),
			);
		// The row is not there: the Sub reads again in 150 ms. Nothing changes.
		else move(`the Sub reads ${deps.kid}: no row yet`, "sub", w);
	}
	return out;
}

export const hostedInit: Hosted = {
	booted: false,
	lane: {phase: "idle"},
	asked: [],
	kids: [],
	settled: false,
	pr: "none",
};

/** What a lane's end means, for the eventually check. */
export type EndOf = (w: Hosted) => boolean;

/** The lane has ended. */
export const laneOver: EndOf = (w) => w.lane.phase === "over";
/**
 * The lane is not waiting on a child. Every way out of `running` is a `kid_over` for the running
 * child, so a fair loop that never leaves it is a child the lane started and never heard end.
 */
export const notWaitingOnAChild: EndOf = (w) => w.lane.phase !== "running";

/**
 * The hosted lane's world. `end` picks the "eventually" law: `laneOver` checks every lane ends,
 * `notWaitingOnAChild` checks every child it starts ends with a `kid_over`.
 */
export function hostedWorld(o: HostedOptions, end: EndOf = laneOver): System<Hosted> {
	const key = (w: Hosted) => structuralHash(w);
	return {
		init: hostedInit,
		lanes: 1,
		moves: (w) => movesOf(w, o),
		key,
		canon: key,
		mine: () => true,
		face: () => "",
		ended: (w) => end(w),
	};
}
