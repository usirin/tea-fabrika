import {defineMachine, type Sub, type TimerSub} from "@demlik/tea";
import type {DraftRun} from "@kampus/fabrika/agents/claude";
import {
	allOver,
	type Children,
	type RepliesDeps,
	slotSubs,
	spawn,
	stepChild,
} from "@kampus/pipeline/combos";
import {intentOf} from "@kampus/pipeline/primitives";
import {
	type ChecksSub,
	checksClock,
	checksSub,
	enqueue,
	finish,
	type QueueSub,
	queueClock,
	queueSub,
	readShipFacts,
	rerunChecks,
} from "@kampus/pipeline/stages/ship/machine";
import {type Claimed, type LaneView, routeOf} from "./fabrika.ts";
import {
	askShip,
	type ClaimCmd,
	type CloseCmd,
	claimLane,
	DEFS,
	defaultKnobs,
	finishLane,
	forgetShip,
	isSettle,
	type Knobs,
	makeTree,
	type OperatorCmd,
	type Pass,
	parkAsk,
	ranOf,
	readLane,
	recheckOf,
	releaseLane,
	removeTree,
	type Settle,
	type ShellRow,
	type ShipRow,
	type Step,
	shellDraft,
	shippedOf,
	startTurn,
	stepTurn,
	type TreeCmd,
	type Turn,
	type TurnMsg,
	timerOf,
	turnInFlight,
	type ViewCmd,
} from "./turn.ts";

// The operator, as primitives joined by hand. Today an agent reads the operate
// skill (2,556 lines) and drives a lane: read the fold, spawn the shell its
// state names, read the fold again, park to a person. Here that loop is code:
//
//   claim                   Act
//   make the working copy   Act, the copy named in the state first
//   read the lane           Gather
//   per active task         spawn: one turn each (src/turn.ts)
//     route by state name   a code table (src/fabrika.ts), type-blind
//     queued                remember: Act "started", Gather it back
//     a stage               Gather the brief, Act "dispatched", Draft the shell
//                           (it records its own result), Gather: did it land?
//                           If not, remember its last word, or that it died
//     review                Gather the pull request first; Listen while its
//                           checks run or nobody can say whether it merges
//     the merge queue       Listen; remember what it did
//     a park                gate: a known recipe is an Act, tried again on a
//                           clock; anything else is ask (Act a question, Listen
//                           for the reply, read it by code or a Judge). While
//                           the question is open the recipe is still tried on
//                           the clock, so the act a person does is an answer too
//   all turns over          read the lane again, and loop
//   the end, however        Act: post the record (a lane that landed or tripped),
//                           remove the working copy, let go of the lane
//
// The machine's own spend is code, plus one Jev call per reply a person
// writes in words.

export type {Knobs, ShellRow, ShipRow, Turn};
export {defaultKnobs};

/**
 * What an operator is made with. `ship`: what fills the ship stage. `agent`,
 * the default, starts today's shipper shell, as it always did. `machine`
 * starts the ship machine as a child instead (src/stages/ship/), and no
 * shipper shell runs. The first stage swapped from an agent to code
 * (docs/direction/one-parent-stages-as-slots.md). `program` asks the ship
 * program, started once beside the operator, and waits for its answer: one
 * Cmd, and the program keeps the machine (experiment 66).
 */
export interface OperatorSettings {
	readonly ship?: "agent" | "machine" | "program";
}

export interface Log {
	readonly shells: readonly ShellRow[];
	/** The runs of the ship machine, when it fills the ship stage. Left out when none ran, so a lane a shell shipped reads as it always did. */
	readonly ships?: readonly ShipRow[];
	/** Cmds the machine sent, Jev's among them. */
	readonly cmds: number;
	readonly jev: number;
	readonly passes: number;
}

/** How a run ended. */
export type End =
	| {readonly kind: "terminal"; readonly status: Exclude<LaneView["status"], "active">}
	| {readonly kind: "parked"; readonly why: string}
	/** No claim: another driver has the lane, no seat is free, or it is not a lane to drive. */
	| {
			readonly kind: "unclaimed";
			readonly why: Extract<Claimed, {won: false}>["why"];
			readonly detail: string;
	  }
	| {readonly kind: "stopped"; readonly why: string};

type Closing = "finish" | "remove" | "release";

interface Running {
	/** This run's name: every intent and conversation id starts with it. */
	readonly run: string;
	readonly lane: string;
	readonly knobs: Knobs;
	readonly log: Log;
}

/**
 * A run that holds the lane, and the working copy it made for it. The tree is
 * named in the state before the Act that makes it goes out, so a restart
 * neither makes a second one nor forgets the first, and every way out of
 * here passes through `closing`, which removes it.
 */
interface Holding extends Running {
	readonly token: string;
	readonly tree: string;
}

export type Operator =
	| {readonly phase: "idle"}
	| (Running & {readonly phase: "claiming"; readonly asked: ClaimCmd})
	| (Holding & {readonly phase: "making"; readonly asked: TreeCmd})
	| (Holding & {readonly phase: "reading"; readonly pass: number; readonly asked: ViewCmd})
	| (Holding & {
			readonly phase: "driving";
			readonly pass: number;
			readonly issue: string;
			readonly turns: Children<Turn>;
	  })
	| (Holding & {
			readonly phase: "closing";
			readonly end: End;
			/** The steps after the one in flight. */
			readonly steps: readonly Closing[];
			readonly asked: CloseCmd;
			/** Whether the tree is gone yet. */
			readonly removed: boolean;
	  })
	/** `tree`: the one the run made, `null` when it made none; `removed`: whether it is gone. */
	| (Running & {
			readonly phase: "ended";
			readonly end: End;
			readonly tree: string | null;
			readonly removed: boolean;
	  });

export type OperatorMsg =
	| {readonly type: "start"; readonly run: string; readonly lane: string; readonly knobs: Knobs}
	/** Sent once after booting from saved state: ask again whatever was in flight. */
	| {readonly type: "resume"}
	| TurnMsg;

type AnyMsg = OperatorMsg | Settle;

const emptyLog: Log = {shells: [], cmds: 0, jev: 0, passes: 0};
const running = (s: Running): Running => ({run: s.run, lane: s.lane, knobs: s.knobs, log: s.log});
const holding = (s: Holding): Holding => ({...running(s), token: s.token, tree: s.tree});

function closeCmd(s: Holding, step: Closing): CloseCmd {
	const intent = intentOf(s.run, "end", step);
	switch (step) {
		case "finish":
			return finishLane({lane: s.lane, intent});
		case "remove":
			return removeTree({name: s.tree, intent});
		case "release":
			return releaseLane({lane: s.lane, token: s.token, intent});
	}
}

/**
 * The end, whatever it is: a lane that landed or tripped posts its record
 * first; every run then removes its tree and lets go of the lane.
 */
function closing(s: Holding, end: End): Step<Operator> {
	const record = end.kind === "terminal" && end.status !== "cancelled";
	const [first, ...steps] = (record ? ["finish", "remove", "release"] : ["remove", "release"]) as [
		Closing,
		...Closing[],
	];
	const asked = closeCmd(s, first);
	return [{...holding(s), phase: "closing", end, steps, asked, removed: false}, [asked]];
}

function reading(s: Holding, pass: number): Step<Operator> {
	const asked = readLane({key: "", lane: s.lane});
	return [{...holding(s), log: {...s.log, passes: pass}, phase: "reading", pass, asked}, [asked]];
}

/** A fresh read of the lane: end it, or spawn a turn for each active task that is not finished. */
function drive(
	s: Extract<Operator, {phase: "reading"}>,
	view: LaneView,
	settings: OperatorSettings,
): Step<Operator> {
	if (view.status !== "active") return closing(s, {kind: "terminal", status: view.status});
	const spent = s.log.shells.reduce((sum, r) => sum + r.spend.costUsd, 0);
	if (spent >= s.knobs.maxRunUsd) {
		const why = `the run's shells have cost $${spent.toFixed(2)}, past its limit of $${s.knobs.maxRunUsd}`;
		return closing(s, {kind: "stopped", why});
	}
	const open = view.tasks.filter((t) => routeOf(t.state)?.kind !== "final");
	if (open.length === 0)
		return closing(s, {kind: "stopped", why: "the lane is active and has no task to drive"});
	const p: Pass = {
		run: s.run,
		lane: s.lane,
		pass: s.pass,
		issue: view.issue,
		tree: s.tree,
		knobs: s.knobs,
		...filled(settings),
	};
	let turns: Children<Turn> = {};
	const cmds: OperatorCmd[] = [];
	for (const task of open) {
		const [turn, out] = startTurn(task, p);
		const next = spawn(turns, task.task, turn, s.knobs.slots);
		if (next === null) break; // every slot is taken: the rest wait for the next pass
		turns = next;
		cmds.push(...out);
	}
	const driving = {
		...holding(s),
		phase: "driving" as const,
		pass: s.pass,
		issue: view.issue,
		turns,
	};
	return joined(driving, cmds);
}

/** Once every turn is over: stop, park, or read the lane again. */
function joined(
	s: Extract<Operator, {phase: "driving"}>,
	cmds: readonly OperatorCmd[],
): Step<Operator> {
	if (!allOver(s.turns, (t) => t.phase === "over")) return [s, cmds];
	const ends = Object.values(s.turns).flatMap((c) =>
		c.state.phase === "over" ? [{task: c.state.task, end: c.state.end}] : [],
	);
	const whys = (kind: "stopped" | "parked") =>
		ends.flatMap((e) => (e.end.kind === kind ? [`${e.task}: ${e.end.why}`] : [])).join("; ");
	if (whys("stopped") !== "") return closing(s, {kind: "stopped", why: whys("stopped")});
	if (whys("parked") !== "") return closing(s, {kind: "parked", why: whys("parked")});
	const [next, more] = reading(s, s.pass + 1);
	return [next, [...cmds, ...more]];
}

/** Which turn a Msg is for: the key on its Cmd, or on the Msg itself. `null`: the run's own. */
function keyOf(m: AnyMsg): string | null {
	if (isSettle(m)) return typeof m.cmd.key === "string" && m.cmd.key !== "" ? m.cmd.key : null;
	return "key" in m && typeof m.key === "string" ? m.key : null;
}

/**
 * Which turn a ship machine's Msg is for. The child's Cmds and Listens carry
 * no `key`: each names its pull request, and the turn that is shipping that
 * pull request is the one. A write that lands it names it inside its proof.
 */
function shipKeyOf(turns: Children<Turn>, m: AnyMsg): string | null {
	if (!m.type.startsWith("ship_")) return null;
	const pr = isSettle(m) ? prOfCmd(m.cmd) : "pr" in m ? m.pr : null;
	const turn = Object.values(turns).find((c) => c.state.phase === "shipping" && c.state.on === pr);
	return turn === undefined ? null : turn.state.task;
}

/** The pull request a ship Cmd names: its own `pr`, or its proof's. */
function prOfCmd(cmd: Readonly<Record<string, unknown>>): unknown {
	const ready = cmd.ready;
	return typeof ready === "object" && ready !== null && "pr" in ready ? ready.pr : cmd.pr;
}

/** What fills the ship stage, as a pass carries it. Nothing when it is the shell, so such a pass is as it always was. */
const filled = (settings: OperatorSettings): {readonly ship?: "machine" | "program"} =>
	settings.ship === "machine" || settings.ship === "program" ? {ship: settings.ship} : {};

function step(s: Operator, m: AnyMsg, settings: OperatorSettings): Step<Operator> {
	if (m.type === "start") {
		if (s.phase !== "idle") return [s, []];
		const asked = claimLane({lane: m.lane, intent: intentOf(m.run, "claim")});
		return [
			{run: m.run, lane: m.lane, knobs: m.knobs, log: emptyLog, phase: "claiming", asked},
			[asked],
		];
	}
	if (m.type === "resume") return resumed(s);
	switch (s.phase) {
		case "claiming": {
			if (m.type === claimLane.errType)
				return [ended(s, {kind: "stopped", why: "the claim could not be read or written"}), []];
			if (m.type !== claimLane.okType) return [s, []];
			const claimed = (m as {value: Claimed}).value;
			if (!claimed.won)
				return [ended(s, {kind: "unclaimed", why: claimed.why, detail: claimed.detail}), []];
			// The tree is named here, in the state, before the Act that makes it.
			const tree = `${s.lane}-${s.run}`;
			const asked = makeTree({name: tree, intent: intentOf(s.run, "tree")});
			return [{...running(s), phase: "making", token: claimed.token, tree, asked}, [asked]];
		}
		case "making":
			if (m.type === makeTree.errType)
				return closing(s, {kind: "stopped", why: "the working copy could not be made"});
			return m.type === makeTree.okType ? reading(s, 1) : [s, []];
		case "reading":
			if (keyOf(m) !== null) return [s, []];
			if (m.type === readLane.errType)
				return closing(s, {kind: "stopped", why: "the lane could not be read"});
			return m.type === readLane.okType
				? drive(s, (m as {value: LaneView}).value, settings)
				: [s, []];
		case "driving": {
			const key = keyOf(m) ?? shipKeyOf(s.turns, m);
			const turn = key === null ? undefined : s.turns[key];
			if (key === null || turn === undefined) return [s, []];
			const ran = ranOf(turn.state, m);
			const shipped = shippedOf(turn.state, m);
			const p: Pass = {
				run: s.run,
				lane: s.lane,
				pass: s.pass,
				issue: s.issue,
				tree: s.tree,
				knobs: s.knobs,
				...filled(settings),
			};
			const [turns, cmds] = stepChild(s.turns, key, (t) => stepTurn(t, m, p));
			const withShell = ran === null ? s.log : {...s.log, shells: [...s.log.shells, ran]};
			const log =
				shipped === null ? withShell : {...withShell, ships: [...(withShell.ships ?? []), shipped]};
			return joined({...s, turns, log}, cmds);
		}
		case "closing": {
			if (m.type !== `${s.asked.type}_ok` && m.type !== `${s.asked.type}_err`) return [s, []];
			// A step that fails does not hold the next: a lane left claimed is worse than one left untidy.
			const removed = s.removed || m.type === removeTree.okType;
			const [next, ...steps] = s.steps;
			if (next === undefined)
				return [{...running(s), phase: "ended", end: s.end, tree: s.tree, removed}, []];
			const asked = closeCmd(s, next);
			return [{...s, steps, asked, removed}, [asked]];
		}
		default:
			return [s, []];
	}
}

const ended = (s: Running, end: End): Operator => ({
	...running(s),
	phase: "ended",
	end,
	tree: null,
	removed: false,
});

function resumed(s: Operator): Step<Operator> {
	switch (s.phase) {
		case "claiming":
		case "making":
		case "reading":
		case "closing":
			return [s, [s.asked]];
		case "driving":
			return [s, Object.values(s.turns).flatMap((c) => turnInFlight(c.state))];
		default:
			return [s, []];
	}
}

/** The machine's update, for an operator made with these settings: one step, and a count of what went out and how much of it was Jev. */
export const updateWith =
	(settings: OperatorSettings) =>
	(s: Operator, m: AnyMsg): Step<Operator> => {
		const [next, cmds] = step(s, m, settings);
		if (next.phase === "idle" || cmds.length === 0) return [next, cmds];
		const jev = cmds.filter((c) => c.type === parkAsk.judge.ask.cmdType).length;
		return [
			{...next, log: {...next.log, cmds: next.log.cmds + cmds.length, jev: next.log.jev + jev}},
			cmds,
		];
	};

/** The update of an operator whose ship stage is today's shipper shell. */
export const update = updateWith({});

// ---------------------------------------------------------------- the Subs

export interface AtDeps {
	readonly key: string;
	readonly lane: string;
	readonly task: string;
	/** The pull request being watched. */
	readonly pr: string;
}

export type OperatorSub =
	| Sub<"shell", DraftRun>
	| Sub<"pr_watch", AtDeps>
	| Sub<"queue", AtDeps>
	| Sub<"park_replies", RepliesDeps>
	| TimerSub<OperatorMsg>;

const turnsOf = (s: Operator) => (s.phase === "driving" ? s.turns : null);
const at = (t: Turn & {readonly on: string}, s: Operator): AtDeps => ({
	key: t.task,
	lane: s.phase === "idle" ? "" : s.lane,
	task: t.task,
	pr: t.on,
});

/** Each kind of thing a turn may listen to, one entry per slot. */
function subsFor(slots: number) {
	return [
		...slotSubs(slots, "shell", turnsOf, (t: Turn) => (t.phase === "drafting" ? t.run : null)),
		...slotSubs(slots, "pr_watch", turnsOf, (t: Turn, s: Operator) =>
			t.phase === "pr_waiting" ? at(t, s) : null,
		),
		...slotSubs(slots, "queue", turnsOf, (t: Turn, s: Operator) =>
			t.phase === "queued" ? at(t, s) : null,
		),
		...slotSubs(slots, "park_replies", turnsOf, (t: Turn) =>
			t.phase === "asking" ? parkAsk.listening(t.ask) : null,
		),
		...slotSubs(slots, "timer", turnsOf, (t: Turn, s: Operator) =>
			s.phase === "driving" ? timerOf(t, s.knobs) : null,
		),
		// An open question runs two clocks at once: its own limit above, and the next try of the park's recipe here.
		...slotSubs(slots, "timer", turnsOf, (t: Turn, s: Operator) =>
			s.phase === "driving" ? recheckOf(t, s.knobs) : null,
		),
	];
}

/** Every Msg type the machine has a cell for: its own, and each Cmd's two answers. */
const MSG_TYPES = [
	"start",
	"resume",
	shellDraft.types.tool,
	shellDraft.types.finished,
	shellDraft.types.failed,
	"pr_read",
	"queue_read",
	"park_reply",
	"shell_overtime",
	"recheck",
	"queue_stalled",
	"pr_overdue",
	"ask_overdue",
	"ask_recheck",
	...DEFS.flatMap((d) => [d.okType, d.errType]),
];

/** The operator whose ship stage is today's shipper shell: as it always was. */
function withShipper(slots: number) {
	return defineMachine({
		types: {model: {} as Operator, msg: {} as OperatorMsg, sub: {} as OperatorSub, ctx: undefined},
		cmds: DEFS,
		init: (loaded) => [loaded ?? {phase: "idle"}, []],
		update: Object.fromEntries(MSG_TYPES.map((type) => [type, update])) as never,
		subs: subsFor(slots) as never,
	});
}

/** The ship machine's Cmds, which the operator sends for its child. */
const SHIP_DEFS = [readShipFacts, rerunChecks, enqueue, finish] as const;
const WITH_SHIP_DEFS = [...DEFS, ...SHIP_DEFS] as const;
/** The Msgs the child hears: its Listens, its clocks, and each of its Cmds' two answers. */
const SHIP_MSG_TYPES = [
	"ship_checks",
	"ship_queue",
	"ship_checks_overdue",
	"ship_queue_overdue",
	...SHIP_DEFS.flatMap((d) => [d.okType, d.errType]),
];

/** The child's two Listens and their two clocks, one entry per slot, open by the child's own rules. */
function shipSubsFor(slots: number) {
	const child =
		<D>(deps: (ship: Extract<Turn, {phase: "shipping"}>["ship"]) => D | null) =>
		(t: Turn) =>
			t.phase === "shipping" ? deps(t.ship) : null;
	return [
		...slotSubs(slots, "ship_checks", turnsOf, child(checksSub.deps)),
		...slotSubs(slots, "ship_queue", turnsOf, child(queueSub.deps)),
		...slotSubs(slots, "timer", turnsOf, child(checksClock.deps)),
		...slotSubs(slots, "timer", turnsOf, child(queueClock.deps)),
	];
}

/** The operator whose ship stage is the ship machine, run as a child. It declares the child's Cmds and Listens as its own. */
function withShipMachine(slots: number) {
	const update = updateWith({ship: "machine"});
	return defineMachine({
		types: {
			model: {} as Operator,
			msg: {} as OperatorMsg,
			sub: {} as OperatorSub | ChecksSub | QueueSub,
			ctx: undefined,
		},
		cmds: WITH_SHIP_DEFS,
		init: (loaded) => [loaded ?? {phase: "idle"}, []],
		update: Object.fromEntries(
			[...MSG_TYPES, ...SHIP_MSG_TYPES].map((type) => [type, update]),
		) as never,
		subs: [...subsFor(slots), ...shipSubsFor(slots)] as never,
	});
}

/**
 * The operator whose ship stage is the ship program, asked. It declares two
 * Cmds more than the shell's operator (the ask, and the forget once the
 * answer is saved), and no Listen: the program, started beside it, runs the
 * machine and its Listens.
 */
function withShipProgram(slots: number) {
	const update = updateWith({ship: "program"});
	return defineMachine({
		types: {model: {} as Operator, msg: {} as OperatorMsg, sub: {} as OperatorSub, ctx: undefined},
		cmds: [...DEFS, askShip, forgetShip] as const,
		init: (loaded) => [loaded ?? {phase: "idle"}, []],
		update: Object.fromEntries(
			[...MSG_TYPES, askShip.okType, askShip.errType, forgetShip.okType, forgetShip.errType].map(
				(type) => [type, update],
			),
		) as never,
		subs: subsFor(slots) as never,
	});
}

/**
 * The operator machine. Its number of slots is fixed when it is made, because
 * tea's subs are a fixed list; a run's `knobs.slots` must not be larger. One
 * update function, routed inside by Msg type the way Elm's `case msg of` is:
 * tea wants a cell per type, so every type gets the same cell.
 *
 * `settings.ship`: what fills the ship stage. Left out, or `agent`, the
 * machine is the one it always was, cell for cell.
 */
export function createOperator(
	slots?: number,
	settings?: {readonly ship?: "agent"},
): ReturnType<typeof withShipper>;
export function createOperator(
	slots: number,
	settings: {readonly ship: "machine"},
): ReturnType<typeof withShipMachine>;
export function createOperator(
	slots: number,
	settings: {readonly ship: "program"},
): ReturnType<typeof withShipProgram>;
export function createOperator(slots = defaultKnobs.slots, settings: OperatorSettings = {}) {
	if (settings.ship === "machine") return withShipMachine(slots);
	return settings.ship === "program" ? withShipProgram(slots) : withShipper(slots);
}
