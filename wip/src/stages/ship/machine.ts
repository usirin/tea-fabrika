import {defineMachine, type Sub, type TimerSub} from "@demlik/tea";
import {Schema} from "effect";
import {act, gather, intentOf, listen} from "../../primitives.ts";
import {nameOf} from "../outcome.ts";
import {Merged, Rerun, ShipFacts} from "./facts.ts";
import {shipGate} from "./gate.ts";
import {type Landing, landed, type ShipOutcome} from "./outcome.ts";
import {Ready, ReadyToMerge} from "./ready.ts";

// The ship machine: one pull request in, one typed outcome out, no agent in
// between (`docs/ship-machine.md`). It is made of four moves:
//
//   Gather  read the facts, fresh, at the commit about to land
//   Check   the gate (./gate.ts): go, wait, or the one reason not to
//   Act     run red checks again, once; put the head in the merge queue, or
//           merge it straight in when there is no queue; after it lands, tidy up
//   Listen  the checks, while they run; the merge queue, while the pull
//           request is in it; and a clock beside each, for its limit
//
// Its input is the pull request and nothing else, so it runs alone or as a
// child, the same way. A parent steps it with `applyCell` and reads `outcome`
// when the phase is `over`. It never decides what the pipeline does next.
//
// A machine is made with its own settings (`createShip`). Nothing is read from
// the computer it runs on.
//
// Only the machine is here. Its handlers and the runners behind its two
// Listens are in ./handlers.ts. The ones that write have only ever answered
// a scripted `gh`.

const Unknown = ["unknown"] as const;
const At = Schema.Struct({pr: Schema.String});
const AtHead = Schema.Struct({pr: Schema.String, head: Schema.String});

/** Everything the gate needs, read in one go. */
export const readShipFacts = gather("ship_facts", {input: At, ok: ShipFacts, err: Unknown});

/** Run the failed checks of this head again. It answers which runs it started again, so the wait after it can tell the new run from the old red one. */
export const rerunChecks = act("ship_rerun_checks", {
	input: AtHead,
	ok: Schema.Array(Rerun),
	err: Unknown,
});

/**
 * What a write that lands a pull request takes: the proof it may merge, which
 * names the pull request and the head. Nothing else: a bare pull request and
 * head, or a value shaped like a proof, does not compile (./ready.test.ts).
 */
const Proven = Schema.Struct({ready: Ready});

/**
 * Put the proven head in the merge queue. It refuses when the head is no
 * longer this one. `no_queue`: the repository has no merge queue, and nothing
 * was written. `stale`: the facts read again at the door of the write
 * (./door.ts) no longer go through the gate, and nothing was written.
 */
export const enqueue = act("ship_enqueue", {
	input: Proven,
	ok: Schema.Literals(["queued", "head_moved", "conflicts", "no_queue", "stale"]),
	err: Unknown,
});

/** How a merge went, or `stale`: the facts read again at the door no longer go through the gate, and nothing was written. */
export const MergeAnswer = Schema.Union([
	Merged,
	Schema.Struct({reading: Schema.Literal("stale")}),
]);
export type MergeAnswer = typeof MergeAnswer.Type;

/** Merge the proven head, for a repository with no merge queue. It refuses when the head is no longer this one. */
export const merge = act("ship_merge", {input: Proven, ok: MergeAnswer, err: Unknown});

/** The tidy-up after a merge: label flagged work, remove the working copies. */
export const finish = act("ship_finish", {input: At, ok: Schema.Null, err: Unknown});

type ReadCmd = ReturnType<typeof readShipFacts>;
type RerunCmd = ReturnType<typeof rerunChecks>;
type EnqueueCmd = ReturnType<typeof enqueue>;
type MergeCmd = ReturnType<typeof merge>;
type FinishCmd = ReturnType<typeof finish>;
export type ShipCmd = ReadCmd | RerunCmd | EnqueueCmd | MergeCmd | FinishCmd;

type AtHead = {readonly pr: string; readonly head: string};
/**
 * The checks of one pull request at one head. The runner says when none is
 * still running, once. It does not say how they went. `after`: the runs that
 * were started again; the checks have not settled until each has finished a
 * later try than the one named, so the old red run is never taken for the new.
 */
export type ChecksSub = Sub<"ship_checks", AtHead & {readonly after: readonly Rerun[]}>;
/** The merge queue, for one pull request at one head. The runner says how it left the queue, once. */
export type QueueSub = Sub<"ship_queue", AtHead>;

/** How long each wait may last, in ms. */
export interface Waits {
	/** Checks still running, or running again. */
	readonly checksMs: number;
	/** The pull request in the merge queue. */
	readonly queueMs: number;
}

/** The machine's own limits, for a setting left out. Starting numbers, not measured ones. */
export const DEFAULT_WAITS: Waits = {checksMs: 15 * 60_000, queueMs: 60 * 60_000};

/** A ship machine's settings. Each one left out takes the machine's own default. */
export interface ShipConfig {
	readonly waits?: Partial<Waits>;
}

/** How many times the branch may move under the enqueue before the machine gives up. */
export const MAX_MOVES = 3;

/**
 * How many times one run may wait on the checks. Each wait has its own clock;
 * this counts the waits. Checks that settle and then read as pending again
 * keep starting new runs, and a run that waits on them without a count never
 * ends. Past this many, the checks are stuck. A starting number.
 */
export const MAX_WAITS = 5;

/** `waits`: the limits this run started with, kept in the state so a restart goes by the same numbers. */
type Held = {readonly pr: string; readonly waits: Waits};
/**
 * What a run remembers from one read to the next. `moves`: how many times the
 * head has moved under an enqueue. `rerunFor`: the head whose red checks were
 * already run again, so a new head gets a re-run of its own. `waited`: how
 * many times it has waited on the checks, which numbers each wait's clock.
 */
type Sofar = Held & {
	readonly moves: number;
	readonly rerunFor: string | null;
	readonly waited: number;
};
/**
 * What the gate said go with. Kept from the gate's answer, never worked out
 * again: the proof it may merge (its head is `ready.head`), and how it lands.
 */
type Going = {readonly ready: ReadyToMerge; readonly landing: Landing};

/**
 * Each phase that has a Cmd in flight keeps it as `asked`: an Act's intent is
 * in the state before the Cmd goes out, and `resume` sends the same Cmd again.
 * The two phases that wait (`waiting`, `queued`) have none: their Listens open
 * again by themselves.
 */
export type Ship =
	| {readonly phase: "idle"}
	| (Sofar & {readonly phase: "reading"; readonly asked: ReadCmd})
	| (Sofar & {readonly phase: "rerunning"; readonly head: string; readonly asked: RerunCmd})
	/** The checks of `head` are running, for the first time or again. */
	| (Sofar & {readonly phase: "waiting"; readonly head: string; readonly after: readonly Rerun[]})
	| (Sofar & Going & {readonly phase: "enqueueing"; readonly asked: EnqueueCmd})
	/** No merge queue: the head is merged straight in. */
	| (Sofar & Going & {readonly phase: "merging"; readonly asked: MergeCmd})
	| (Held & Going & {readonly phase: "queued"})
	| (Held & {
			readonly phase: "finishing";
			readonly commit: string;
			readonly landing: Landing;
			readonly asked: FinishCmd;
	  })
	| (Held & {readonly phase: "over"; readonly outcome: ShipOutcome});

export type ShipMsg =
	| {readonly type: "start"; readonly pr: string}
	/** Sent once after booting from saved state: re-issue whatever was in flight. */
	| {readonly type: "resume"}
	/** From a Listen. Each names its pull request and head, so a parent with several ships can route it and an old one is told apart. */
	| {readonly type: "ship_checks"; readonly pr: string; readonly head: string}
	/** `commit`: the commit on the base branch. With a merge queue or a squash it is not the head. */
	| {
			readonly type: "ship_queue";
			readonly pr: string;
			readonly head: string;
			readonly reading: "landed";
			readonly commit: string;
	  }
	| {
			readonly type: "ship_queue";
			readonly pr: string;
			readonly head: string;
			readonly reading: "ejected";
	  }
	/** From a clock: a wait reached its limit. `wait` numbers the wait it was set for. */
	| {
			readonly type: "ship_checks_overdue";
			readonly pr: string;
			readonly head: string;
			readonly wait: number;
	  }
	| {readonly type: "ship_queue_overdue"; readonly pr: string; readonly head: string};

type Step = readonly [Ship, readonly ShipCmd[]];

const stay = (s: Ship): Step => [s, []];
const over = (s: Held, outcome: ShipOutcome): Step => [
	{phase: "over", pr: s.pr, waits: s.waits, outcome},
	[],
];
const sofar = (s: Sofar): Sofar => ({
	pr: s.pr,
	waits: s.waits,
	moves: s.moves,
	rerunFor: s.rerunFor,
	waited: s.waited,
});
const isHere = (s: Held & {readonly head: string}, m: AtHead): boolean =>
	m.pr === s.pr && m.head === s.head;
/** The head a run that went on from the gate is landing: the one its proof names. */
const landingHead = (s: Going): string => s.ready.head;

/**
 * A state read back from storage is checked again, not trusted: its proof,
 * and the one in the Cmd in flight, must still prove every criterion, or the
 * run stops. A kept proof that was edited never reaches a write.
 */
function revived(s: Ship): Ship {
	if (s.phase !== "enqueueing" && s.phase !== "merging" && s.phase !== "queued") return s;
	const proofs = s.phase === "queued" ? [s.ready] : [s.ready, s.asked.ready];
	return proofs.every((p) => ReadyToMerge.revive(p) !== null)
		? s
		: {phase: "over", pr: s.pr, waits: s.waits, outcome: {kind: "stuck", why: "proof_refused"}};
}

function read(s: Sofar): Step {
	const asked = readShipFacts({pr: s.pr});
	return [{...sofar(s), phase: "reading", asked}, [asked]];
}
/**
 * The head moved under a write, or the facts changed under it (`stale`). Read
 * fresh, again, and go through the gate again: a branch that keeps moving
 * does not spin the machine forever.
 */
const moved = (s: Sofar): Step =>
	s.moves >= MAX_MOVES
		? over(s, {kind: "stuck", why: "head_moving"})
		: read({...s, moves: s.moves + 1});
/** Merged as `commit` on the base branch, by the queue or straight in: tidy up. */
function landedAs(s: Held & Going, commit: string): Step {
	const asked = finish({pr: s.pr, intent: intentOf("ship", s.pr, "finish", landingHead(s))});
	return [
		{phase: "finishing", pr: s.pr, waits: s.waits, commit, landing: s.landing, asked},
		[asked],
	];
}
/** Wait on the checks of `head`, with a clock of its own, unless it has waited `MAX_WAITS` times. */
const wait = (s: Sofar, head: string, after: readonly Rerun[] = []): Step =>
	s.waited >= MAX_WAITS
		? over(s, {kind: "stuck", why: "checks_stuck"})
		: [{...sofar(s), phase: "waiting", head, after, waited: s.waited + 1}, []];

/** The Listen on the checks: open only while they run. Nothing is paid to wait. */
export const checksSub = listen("ship_checks", (s: Ship) =>
	s.phase === "waiting" ? {pr: s.pr, head: s.head, after: s.after} : null,
);
/** The Listen on the merge queue: open only while the pull request is in it. */
export const queueSub = listen("ship_queue", (s: Ship) =>
	s.phase === "queued" ? {pr: s.pr, head: landingHead(s)} : null,
);
/** The clock beside each Listen. Its Msg names the wait it was set for, so each wait sets a new clock. */
export const checksClock = listen("timer", (s: Ship) =>
	s.phase === "waiting"
		? {
				ms: s.waits.checksMs,
				msg: {type: "ship_checks_overdue" as const, pr: s.pr, head: s.head, wait: s.waited},
			}
		: null,
);
export const queueClock = listen("timer", (s: Ship) =>
	s.phase === "queued"
		? {
				ms: s.waits.queueMs,
				msg: {type: "ship_queue_overdue" as const, pr: s.pr, head: landingHead(s)},
			}
		: null,
);

/**
 * A ship machine, made with its own settings. A run copies them into its
 * state when it starts, so a run that is saved and started again goes by the
 * numbers it began with, whatever machine picks it up.
 */
export function createShip(config: ShipConfig = {}) {
	const waits: Waits = {...DEFAULT_WAITS, ...config.waits};
	return defineMachine({
		types: {
			model: {} as Ship,
			msg: {} as ShipMsg,
			sub: {} as ChecksSub | QueueSub | TimerSub<ShipMsg>,
			ctx: undefined,
		},
		cmds: [readShipFacts, rerunChecks, enqueue, merge, finish],
		init: (loaded) => [loaded == null ? {phase: "idle"} : revived(loaded), []],
		update: {
			start: (s, m): Step =>
				s.phase === "idle" ? read({pr: m.pr, waits, moves: 0, rerunFor: null, waited: 0}) : stay(s),
			resume: (s): Step => ("asked" in s ? [s, [s.asked]] : stay(s)),

			ship_facts_ok: (s, m): Step => {
				if (s.phase !== "reading") return stay(s);
				const gate = shipGate(s.pr, m.value);
				switch (gate.answer) {
					case "go": {
						// The only way to an enqueue: the gate's proof, carried on as it was made.
						const {ready, landing} = gate;
						const asked = enqueue({ready, intent: intentOf("ship", s.pr, "enqueue", ready.head)});
						return [{...sofar(s), phase: "enqueueing", ready, landing, asked}, [asked]];
					}
					case "wait_for_checks":
						return wait(s, gate.head);
					case "stop": {
						const {outcome} = gate;
						const {head} = m.value;
						// Red checks are run again once before the builder is called. Once for each head: a new head starts over.
						if (nameOf(outcome) !== "send:builder:checks_red" || s.rerunFor === head)
							return over(s, outcome);
						const asked = rerunChecks({
							pr: s.pr,
							head,
							intent: intentOf("ship", s.pr, "rerun", head),
						});
						return [{...sofar(s), phase: "rerunning", head, rerunFor: head, asked}, [asked]];
					}
				}
			},
			ship_facts_err: (s): Step =>
				s.phase === "reading" ? over(s, {kind: "stuck", why: "read_failed"}) : stay(s),

			ship_rerun_checks_ok: (s, m): Step =>
				s.phase === "rerunning" && m.cmd.intent === s.asked.intent
					? wait(s, s.head, m.value)
					: stay(s),
			// The re-run was only a courtesy. Without it the answer is the one the gate gave: the checks are red.
			ship_rerun_checks_err: (s, m): Step =>
				s.phase === "rerunning" && m.cmd.intent === s.asked.intent
					? over(s, {kind: "send", to: "builder", why: "checks_red"})
					: stay(s),

			// The Listen says only that the checks settled. How they went is read fresh, and goes through the gate again.
			ship_checks: (s, m): Step => (s.phase === "waiting" && isHere(s, m) ? read(s) : stay(s)),
			ship_checks_overdue: (s, m): Step =>
				s.phase === "waiting" && isHere(s, m) && m.wait === s.waited
					? over(s, {kind: "stuck", why: "checks_stuck"})
					: stay(s),

			ship_enqueue_ok: (s, m): Step => {
				// An answer to an enqueue of another head is an old one: a Cmd sent twice answers twice.
				if (s.phase !== "enqueueing" || m.cmd.intent !== s.asked.intent) return stay(s);
				switch (m.value) {
					case "queued":
						return [
							{phase: "queued", pr: s.pr, waits: s.waits, ready: s.ready, landing: s.landing},
							[],
						];
					case "conflicts":
						return over(s, {kind: "send", to: "builder", why: "conflicts"});
					case "head_moved":
					case "stale":
						return moved(s);
					case "no_queue": {
						// No queue to wait in: the same head, through the same gate, is merged straight in.
						const asked = merge({
							ready: s.ready,
							intent: intentOf("ship", s.pr, "merge", landingHead(s)),
						});
						return [{...s, phase: "merging", asked}, [asked]];
					}
				}
			},
			// Nobody knows whether it is in the queue. Stop, and say so.
			ship_enqueue_err: (s, m): Step =>
				s.phase === "enqueueing" && m.cmd.intent === s.asked.intent
					? over(s, {kind: "stuck", why: "enqueue_failed"})
					: stay(s),

			ship_merge_ok: (s, m): Step => {
				if (s.phase !== "merging" || m.cmd.intent !== s.asked.intent) return stay(s);
				switch (m.value.reading) {
					case "merged":
						return landedAs(s, m.value.commit);
					case "conflicts":
						return over(s, {kind: "send", to: "builder", why: "conflicts"});
					case "head_moved":
					case "stale":
						return moved(s);
				}
			},
			// Nobody knows whether it merged. Stop, and say so.
			ship_merge_err: (s, m): Step =>
				s.phase === "merging" && m.cmd.intent === s.asked.intent
					? over(s, {kind: "stuck", why: "merge_failed"})
					: stay(s),

			ship_queue: (s, m): Step => {
				if (s.phase !== "queued" || !isHere({...s, head: landingHead(s)}, m)) return stay(s);
				if (m.reading === "ejected") return over(s, {kind: "send", to: "builder", why: "ejected"});
				// The commit is the one the queue's Listen names, on the base branch: never the head taken for it.
				return landedAs(s, m.commit);
			},
			// The pull request may still be in the queue. The machine says so and does not pull it out.
			ship_queue_overdue: (s, m): Step =>
				s.phase === "queued" && isHere({...s, head: landingHead(s)}, m)
					? over(s, {kind: "stuck", why: "queue_silent"})
					: stay(s),

			ship_finish_ok: (s): Step =>
				s.phase === "finishing" ? over(s, landed(s.landing, s.commit, "done")) : stay(s),
			// It merged all the same. The landing is the answer, and it says the tidy-up broke.
			ship_finish_err: (s): Step =>
				s.phase === "finishing" ? over(s, landed(s.landing, s.commit, "failed")) : stay(s),
		},
		subs: [checksSub, queueSub, checksClock, queueClock],
	});
}

/** A ship machine with every setting left at its default. */
export const ship = createShip();
