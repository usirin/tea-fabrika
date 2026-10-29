import {replay} from "@demlik/tea";
import type {Writer} from "@kampus/fabrika";
import type {Entry} from "@kampus/pipeline/tickets/ticket";
import {load, type Tracker, tracker} from "./machine.ts";

// A stand-in: ticket #7 as a lane would leave it, for tests and the app's screenshots. No lane
// writes tracker tickets yet (docs/direction/a-ticket-runs-from-the-app.md), so no real ticket
// has these facts. Every fact type, stage name and outcome here is the pipeline's own; the times,
// costs, token counts, the run, task and trace ids and the writer `agent:lane` are made up.
//
//   10:02  owner   filed it
//   10:02  lane    triage started, r-1
//   10:03  lane    triage: sent to plan: yes             $0.11, 1 turn
//   10:03  lane    plan started, r-2
//   10:09  lane    plan: done                            $0.38, 9 turns
//   10:09  lane    plan v1, 2 tasks
//   10:09  lane    asks you: approve plan v1             approve / no
//
// `SEVEN_NOW` is 10:14 on the same day: five minutes into the wait.

/** When a fact of the stand-in was written: on 2026-10-27, in UTC. */
export const atSeven = (hour: number, minute: number): number =>
	Date.UTC(2026, 9, 27, hour, minute);

/** The time the stand-in is looked at. */
export const SEVEN_NOW = atSeven(10, 14);

export const OWNER: Writer = {kind: "user", id: "owner"};
export const LANE: Writer = {kind: "agent", id: "lane", for: "owner"};

/**
 * The trace id of the lane's job: the key of its record. Both runs carry it on their `started`,
 * since a lane's stages are one job (docs/direction/a-job-record-holds-its-trace.md). Made up too.
 */
export const SEVEN_TRACE = "7e1a0c3b9d2f4e5a8b6c7d0e1f2a3b4c";

export const SEVEN_TITLE = "`fabrika post` prints the ticket number twice";

export const SEVEN_BODY = [
	"Every line `fabrika post list` prints names the ticket number twice, like `#9 open c28 #9 The ledger moves to Cloudflare`. It should name it once.",
	"",
	"Done when every line names its number exactly once, and the rest of the line does not change.",
].join("\n");

const entry = (pos: number, by: Writer, at: number, fact: Entry["fact"]): Entry => ({
	pos,
	ticket: 7,
	by,
	at,
	fact,
});

/** Ticket #7's facts, oldest first. */
export const SEVEN: readonly Entry[] = [
	entry(1, OWNER, atSeven(10, 2), {type: "filed", title: SEVEN_TITLE, body: SEVEN_BODY}),
	entry(2, LANE, atSeven(10, 2), {
		type: "started",
		run: "r-1",
		stage: "triage",
		task: null,
		log: null,
		trace: SEVEN_TRACE,
	}),
	entry(3, LANE, atSeven(10, 3), {
		type: "ended",
		run: "r-1",
		stage: "triage",
		outcome: {kind: "send", to: "plan", why: "yes"},
		usd: 0.11,
		input: 18_204,
		output: 912,
		turns: 1,
	}),
	entry(4, LANE, atSeven(10, 3), {
		type: "started",
		run: "r-2",
		stage: "plan",
		task: null,
		log: null,
		trace: SEVEN_TRACE,
	}),
	entry(5, LANE, atSeven(10, 9), {
		type: "ended",
		run: "r-2",
		stage: "plan",
		outcome: {kind: "done", part: false},
		usd: 0.38,
		input: 61_870,
		output: 4_410,
		turns: 9,
	}),
	entry(6, LANE, atSeven(10, 9), {type: "planned", version: 1, tasks: ["t-1", "t-2"]}),
	entry(7, LANE, atSeven(10, 9), {
		type: "asked",
		ask: "a-1",
		what: "approve plan v1",
		picks: ["approve", "no"],
	}),
];

/**
 * The tracker's state with these facts read and ticket 7 open, at `now`: what the ticket, map and
 * trace programs show, with no ledger. Its machine's own Msgs, replayed.
 *
 *   trackerAtSeven().open        // 7
 *   trackerAtSeven(SEVEN.slice(0, 3)).tickets[0]?.timeline.length   // 3
 */
export const trackerAtSeven = (entries: readonly Entry[] = SEVEN, now = SEVEN_NOW): Tracker =>
	replay(tracker, {
		ctx: undefined,
		msgs: [
			load.ok(load({after: 0}), {entries, broken: [], last: entries.at(-1)?.pos ?? 0}),
			{type: "open", ticket: 7},
			{type: "tick", now},
		],
	}).state;
