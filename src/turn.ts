import {applyCell} from "@demlik/tea";
import {Schema} from "effect";
import {z} from "zod";
import {
	type Asking,
	createAsk,
	type Gate,
	gateJudge,
	inFlight,
	park,
	pass,
	type Remember,
	type Reply,
	remember,
	sessionOf,
	written,
} from "./combos.ts";
import {createDraft, type DraftMsg, type DraftRun, type Spend} from "./draft.ts";
import {
	type Brief,
	Briefed,
	type BriefRefusal,
	Claimed,
	DriverFact,
	hasRecipe,
	LaneView,
	PARK_ROUTE,
	type ParkCause,
	PrState,
	type QueueReading,
	type Route,
	routeOf,
	Shell,
	type TaskView,
	Unparked,
} from "./fabrika.ts";
import {act, createJudge, gather, intentOf} from "./primitives.ts";
import {nameOf} from "./stages/outcome.ts";
import {
	createShip,
	type Ship,
	type ShipCmd,
	type ShipMsg,
	ship as shipMachine,
} from "./stages/ship/machine.ts";
import type {ShipName, ShipOutcome} from "./stages/ship/outcome.ts";
import {Answer} from "./stages/ship/program.ts";

// One task's turn in one pass of the operator (src/operator.ts): route the
// task by its state's name, do the one thing the route says, and end. The
// operator spawns one turn per active task and reads the lane again once all
// of them are over. A turn is a nested model with a pure update, Elm's way.

// ---------------------------------------------------------------- the Cmds

const Unknown = ["unknown"] as const;
/** `key`: the turn that asked, so its answer comes back to it. */
const At = z.object({key: z.string(), lane: z.string(), task: z.string()});

export const claimLane = act("lane_claim", {
	input: z.object({lane: z.string()}),
	ok: Claimed,
	err: Unknown,
});
/** `key` is the turn that asked, or "" for the run itself. */
export const readLane = gather("lane_view", {
	input: z.object({key: z.string(), lane: z.string()}),
	ok: LaneView,
	err: Unknown,
});
export const readBrief = gather("lane_brief", {input: At, ok: Briefed, err: Unknown});
/** `pr`: the pull request the lane's last read named, so no read is spent finding it again. */
export const readPr = gather("lane_pr", {
	input: At.extend({pr: z.string()}),
	ok: PrState,
	err: Unknown,
});
export const markDispatched = act("lane_dispatched", {
	input: At.extend({shell: Shell}),
	ok: z.null(),
	err: Unknown,
});
/** `true`: written; `false`: fabrika refused it. `pr`: the task's pull request, when it has one. */
export const recordFact = act("lane_record", {
	input: At.extend({fact: DriverFact, pr: z.string().nullable()}),
	ok: z.boolean(),
	err: Unknown,
});
export const unparkTask = act("lane_unpark", {input: At, ok: Unparked, err: Unknown});
export const clearTask = act("lane_clear", {
	input: At.extend({said: z.string(), grant: z.boolean()}),
	ok: z.boolean(),
	err: Unknown,
});
export const finishLane = act("lane_finish", {
	input: z.object({lane: z.string()}),
	ok: z.null(),
	err: Unknown,
});
/**
 * The lane's working copy, by name: made when the lane is claimed, removed
 * however it ends. The first Cmds here written in Effect Schema; the others
 * move when this file is next touched.
 */
export const makeTree = act("tree_make", {
	input: Schema.Struct({name: Schema.String}),
	ok: Schema.Null,
	err: Unknown,
});
export const removeTree = act("tree_remove", {
	input: Schema.Struct({name: Schema.String}),
	ok: Schema.Null,
	err: Unknown,
});
export const releaseLane = act("lane_release", {
	input: z.object({lane: z.string(), token: z.string()}),
	ok: z.null(),
	err: Unknown,
});
/**
 * Ask the ship program, started once beside the operator, to ship the task's
 * pull request, and wait for its answer. The intent is the ask's id: asked
 * again after a restart, the program answers from what it kept, and ships
 * nothing twice. `refused`: the program would not take the ask. `ended`: it
 * ended before it answered.
 */
export const askShip = act("ship_ask", {
	input: Schema.Struct({
		key: Schema.String,
		lane: Schema.String,
		task: Schema.String,
		pr: Schema.String,
	}),
	ok: Answer,
	err: ["refused", "ended"],
});
export type AskShipCmd = ReturnType<typeof askShip>;

export type ClaimCmd = ReturnType<typeof claimLane>;
export type ViewCmd = ReturnType<typeof readLane>;
export type BriefCmd = ReturnType<typeof readBrief>;
export type PrCmd = ReturnType<typeof readPr>;
export type DispatchedCmd = ReturnType<typeof markDispatched>;
export type RecordCmd = ReturnType<typeof recordFact>;
export type UnparkCmd = ReturnType<typeof unparkTask>;
export type ClearCmd = ReturnType<typeof clearTask>;
export type TreeCmd = ReturnType<typeof makeTree>;
export type CloseCmd =
	| ReturnType<typeof finishLane>
	| ReturnType<typeof removeTree>
	| ReturnType<typeof releaseLane>;

/** A shell's last word, typed: its terminal token, and the pull request it names. Read only when its own report did not land. */
export const ShellEnd = z.object({token: z.string(), pr: z.string().nullable()});
export type ShellEnd = z.infer<typeof ShellEnd>;

/** The shells, as a Draft. */
export const shellDraft = createDraft({name: "shell", output: ShellEnd});
export type ShellMsg = DraftMsg<"shell", ShellEnd>;

/** What a person may answer a park with. */
const parkChoices = {
	resume: "It is handled: carry on from where the lane stopped",
	more: "Give the work one more round of repairs, then carry on",
	leave: "Leave the lane parked: a person will take it from here",
} as const;
type ParkChoice = keyof typeof parkChoices;

/** Asking a person about a park, and reading the answer. */
export const parkAsk = createAsk({
	name: "park",
	judge: createJudge({
		name: "park_read",
		instructions:
			"`question` is what a pipeline asked a person about work it had to stop. `reply` is the person's answer. Which option does the reply choose?",
		choices: parkChoices,
	}),
});
export type PostCmd = ReturnType<typeof parkAsk.post>;
export type ReadCmd = ReturnType<typeof parkAsk.judge.ask>;
type AskState = Asking<ParkChoice, PostCmd, ReadCmd>;

export type OperatorCmd =
	| ClaimCmd
	| ViewCmd
	| BriefCmd
	| PrCmd
	| DispatchedCmd
	| RecordCmd
	| UnparkCmd
	| ClearCmd
	| TreeCmd
	| CloseCmd
	| PostCmd
	| ReadCmd
	/** The ship machine's own Cmds, sent only when it fills the ship stage. */
	| ShipCmd
	/** The ask to the ship program, sent only when it fills the ship stage. */
	| AskShipCmd;

export const DEFS = [
	claimLane,
	readLane,
	readBrief,
	readPr,
	markDispatched,
	recordFact,
	unparkTask,
	clearTask,
	makeTree,
	finishLane,
	removeTree,
	releaseLane,
	parkAsk.post,
	parkAsk.judge.ask,
] as const;

// ---------------------------------------------------------------- the model

/** The numbers a run is driven by, copied into its state when it starts, so a restart replays by them. */
export interface Knobs {
	/** How many tasks are driven at once. No more than the machine was made with. */
	readonly slots: number;
	/** How long to wait before trying a recipe on a park again, and how many tries before a person is asked. */
	readonly recheckMs: number;
	readonly rechecks: number;
	/** How long the merge queue may hold a pull request before that counts as stalled. */
	readonly queueStallMs: number;
	/** A minute of a shell's time limit, in ms: 60 000 live, small in tests. */
	readonly msPerMinute: number;
	/** The floor for reading a person's reply in words. */
	readonly askFloor: number;
	/** Whose replies count. */
	readonly who: readonly string[];
	/** What the run's shells may cost in all, in dollars. Past it, no new shell starts and the run stops. */
	readonly maxRunUsd: number;
	/** How long a pull request's checks may take to settle before a review. Past it the run stops. */
	readonly ciWaitMs: number;
	/**
	 * How long a question waits for a person. Past it the run ends parked, with
	 * the question still on the issue: the next run finds it and reads on from there.
	 */
	readonly askWaitMs: number;
}

export const defaultKnobs: Knobs = {
	slots: 4,
	recheckMs: 5 * 60_000,
	rechecks: 6,
	queueStallMs: 60 * 60_000,
	msPerMinute: 60_000,
	askFloor: 0.8,
	who: [],
	maxRunUsd: 15,
	ciWaitMs: 45 * 60_000,
	askWaitMs: 12 * 60 * 60_000,
};

/** How a turn ended. */
export type TurnEnd =
	/** It did its one thing, and the next read of the lane says what follows. */
	| {readonly kind: "moved"}
	/** A person said to leave the lane parked. */
	| {readonly kind: "parked"; readonly why: string}
	/** Something no rule covers: the run stops, and says what. */
	| {readonly kind: "stopped"; readonly why: string};

type ShellRoute = Extract<Route, {kind: "shell"}>;
/** The writes a turn reads back before it counts them. */
type Writes = RecordCmd | ClearCmd | UnparkCmd;

/** What every turn knows: its task, the state it began in, its ledger's length then, and the task's pull request. */
interface Of {
	readonly task: string;
	readonly state: string;
	readonly seq: number;
	readonly pr: string | null;
}

export type Turn = Of &
	(
		| {
				readonly phase: "recording";
				/** What is being written, for the stop line if it does not land. */
				readonly what: string;
				readonly mem: Remember<Writes, ViewCmd>;
				/** How the turn ends once the write shows on the lane. Left out: it moved, and the next read says what follows. */
				readonly after?: TurnEnd;
		  }
		/**
		 * The ship stage, filled by the ship machine in place of the shipper
		 * shell. `ship`: the child's own state, stepped the way any child is.
		 * `phases`: each phase it has stood in, in order, for the field log.
		 */
		| {
				readonly phase: "shipping";
				readonly on: string;
				readonly ship: Ship;
				readonly phases: readonly Ship["phase"][];
		  }
		/**
		 * The ship stage, handed to the ship program: one ask, in flight until
		 * the program answers. The program keeps the machine; the turn keeps
		 * only the ask, under the intent that is its id.
		 */
		| {readonly phase: "handed"; readonly on: string; readonly asked: AskShipCmd}
		| {
				readonly phase: "reading_pr";
				readonly route: ShellRoute;
				readonly on: string;
				readonly asked: PrCmd;
		  }
		/** `on`: the pull request whose checks the turn listens to. */
		| {readonly phase: "pr_waiting"; readonly route: ShellRoute; readonly on: string}
		| {readonly phase: "briefing"; readonly route: ShellRoute; readonly asked: BriefCmd}
		| {
				readonly phase: "dispatching";
				readonly route: ShellRoute;
				readonly brief: Brief;
				readonly asked: DispatchedCmd;
		  }
		| {
				readonly phase: "drafting";
				readonly route: ShellRoute;
				readonly run: DraftRun;
				readonly tools: number;
		  }
		/** The shell ended: read the lane to see if its own report landed. `end`: its last word, if it gave one. */
		| {readonly phase: "confirming"; readonly end: ShellEnd | null; readonly asked: ViewCmd}
		/** `on`: the pull request in the merge queue. */
		| {readonly phase: "queued"; readonly pass: number; readonly on: string}
		| {
				readonly phase: "unparking";
				readonly cause: ParkCause | null;
				readonly tries: number;
				readonly asked: UnparkCmd;
		  }
		| {readonly phase: "rechecking"; readonly cause: ParkCause | null; readonly tries: number}
		/** `recheck`: the park's recipe, tried on while the question is open. `null`: no recipe covers the park, and a reply is the only signal. */
		| {
				readonly phase: "asking";
				readonly cause: ParkCause | null;
				readonly ask: AskState;
				readonly recheck: Recheck | null;
		  }
		| {readonly phase: "over"; readonly end: TurnEnd}
	);

/**
 * A park's recipe, tried again on a clock while its question is open. Where
 * the recipe re-reads something a person does (an owner's approval), the act
 * is the answer, and nobody has to write one. `tries`: how often the recipe
 * has been asked on this turn, the gate's own tries among them. `asked`: the
 * try in flight. `overdue`: the question's wait ran out while it was.
 */
export type Recheck =
	| {readonly tries: number; readonly asked: null}
	| {readonly tries: number; readonly asked: UnparkCmd; readonly overdue: boolean};

/** One pass of the run, as a turn needs it. */
export interface Pass {
	readonly run: string;
	readonly lane: string;
	readonly pass: number;
	readonly issue: string;
	/** The working copy the run made: every shell works in it. */
	readonly tree: string;
	readonly knobs: Knobs;
	/** What fills the ship stage: today's shipper shell, the ship machine as a child, or the ship program, asked. Left out: the shell. */
	readonly ship?: "agent" | "machine" | "program";
}

// ---------------------------------------------------------------- the Msgs

/** The Msgs that arrive on their own, from the turns' Listens and Drafts. */
export type TurnMsg =
	| ShellMsg
	| {readonly type: "pr_read"; readonly key: string; readonly pr: PrState}
	| {readonly type: "queue_read"; readonly key: string; readonly reading: QueueReading}
	| {readonly type: "park_reply"; readonly key: string; readonly reply: Reply}
	| {readonly type: "shell_overtime"; readonly key: string; readonly id: string}
	| {readonly type: "recheck"; readonly key: string; readonly tries: number}
	| {readonly type: "queue_stalled"; readonly key: string; readonly pass: number}
	/** `seq`: the turn's own, so a clock from an earlier turn of the task is told apart. */
	| {readonly type: "pr_overdue"; readonly key: string; readonly seq: number}
	| {readonly type: "ask_overdue"; readonly key: string; readonly seq: number}
	/** The clock of an open question's recipe. `tries`: the tries made when it was set, so a clock from before the last try is told apart. */
	| {
			readonly type: "ask_recheck";
			readonly key: string;
			readonly seq: number;
			readonly tries: number;
	  }
	/** What the ship machine's own Listens and clocks say. They carry no `key`: each names its pull request. */
	| Exclude<ShipMsg, {readonly type: "start" | "resume"}>;

/** A Cmd's answer, as the engine mints it. */
export type Settle =
	| {
			readonly type: `${string}_ok`;
			readonly cmd: Readonly<Record<string, unknown>>;
			readonly value: unknown;
	  }
	| {
			readonly type: `${string}_err`;
			readonly cmd: Readonly<Record<string, unknown>>;
			readonly error: unknown;
	  };

export type Step<S> = readonly [S, readonly OperatorCmd[]];

export const isSettle = (m: {readonly type: string}): m is Settle => "cmd" in m;

// ---------------------------------------------------------------- the turn

const over = (t: Of, end: TurnEnd): Step<Turn> => [{...of(t), phase: "over", end}, []];
const stop = (t: Of, why: string) => over(t, {kind: "stopped", why});
const moved = (t: Of) => over(t, {kind: "moved"});
function of(t: Of): Of {
	return {task: t.task, state: t.state, seq: t.seq, pr: t.pr};
}

/** remember: write a fact, then read the lane back. It counts once the task has left its state. `after`: how the turn ends after that, when not "moved". */
function recording(t: Of, p: Pass, what: string, fact: DriverFact, after?: TurnEnd): Step<Turn> {
	const intent = intentOf(p.run, p.pass, t.task, "record");
	const write = recordFact({key: t.task, lane: p.lane, task: t.task, fact, pr: t.pr, intent});
	const [mem, cmds] = remember<Writes, ViewCmd>(write, readLane({key: t.task, lane: p.lane}));
	return [{...of(t), phase: "recording", what, mem, ...(after === undefined ? {} : {after})}, cmds];
}

// ---------------------------------------------------------------- the ship stage, filled by the ship machine

/**
 * Start the ship machine on the task's pull request, in place of the shipper
 * shell. Its limits are the run's own: how long checks may take, and how long
 * the merge queue may hold a pull request. The child copies them into its
 * state, so any ship machine can step it from here on.
 */
function shipping(t: Of, p: Pass): Step<Turn> {
	if (t.pr === null) return stop(t, `the lane is at \`${t.state}\` and names no pull request`);
	const machine = createShip({waits: {checksMs: p.knobs.ciWaitMs, queueMs: p.knobs.queueStallMs}});
	const [ship, cmds] = applyCell<Ship, ShipMsg, ShipCmd>(
		machine,
		{phase: "idle"},
		{type: "start", pr: t.pr},
	);
	return [{...of(t), phase: "shipping", on: t.pr, ship, phases: [ship.phase]}, cmds];
}

/** One Msg for the ship child. `null`: the Msg is not the child's. */
function shipStep(
	t: Extract<Turn, {phase: "shipping"}>,
	m: {readonly type: string},
): readonly [Ship, readonly ShipCmd[]] | null {
	return m.type.startsWith("ship_")
		? applyCell<Ship, {readonly type: string}, ShipCmd>(shipMachine, t.ship, m)
		: null;
}

/**
 * The one line a ship's outcome writes on the lane, in today's fabrika's own
 * words: the terminal word a shipper shell would have reported for the same
 * ending. Fabrika folds it as it folds a shipper's, so a lane cannot tell who
 * shipped it. `after`: how the turn ends once the line shows; left out, the
 * next read of the lane says what follows.
 *
 *   done                        LANDED, or ALREADY-MERGED when it was found merged
 *   send:builder:conflicts      BASE-CONFLICTED, a lap that costs no repair round
 *   send:builder:ejected        EJECTED
 *   send:builder:<the rest>     ROUTED-REPAIR, a repair round
 *   send:reviewer:no_review     ROUTED-REVIEW; fabrika parks it on `verdict-owed`
 *   ask:owner:approval          AWAITING-CP-APPROVAL; the park whose recipe looks for the approval
 *   ask:commenter:comment       a park with no cause, which the operator asks a person about
 *   skip:<why>                  REFUSED, and the run stops for a person
 *   stuck:<why>                 UNKNOWN, and the run stops for a person
 */
export function shipLine(
	outcome: ShipOutcome,
	pr: string,
): {readonly fact: DriverFact; readonly after?: TurnEnd} {
	const name = nameOf(outcome);
	const token = (word: string): DriverFact => ({kind: "token", token: word, pr});
	const stopped: TurnEnd = {kind: "stopped", why: `the ship machine ended \`${name}\` on ${pr}`};
	switch (outcome.kind) {
		case "done":
			return {fact: token(outcome.cleanup === "not_run" ? "ALREADY-MERGED" : "LANDED")};
		case "send":
			if (outcome.to === "reviewer") return {fact: token("ROUTED-REVIEW")};
			if (outcome.why === "conflicts") return {fact: {kind: "base_conflicted", pr}};
			return {fact: token(outcome.why === "ejected" ? "EJECTED" : "ROUTED-REPAIR")};
		case "ask":
			return {
				fact:
					outcome.who === "owner"
						? token("AWAITING-CP-APPROVAL")
						: {kind: "park", cause: null, why: `the ship machine ended \`${name}\``},
			};
		case "skip":
			return {fact: token("REFUSED"), after: stopped};
		case "stuck":
			return {fact: token("UNKNOWN"), after: stopped};
	}
}

/** The ship child, stepped. When it is over, its outcome is written as one line and the turn goes on from there. */
function stepShip(t: Extract<Turn, {phase: "shipping"}>, m: TurnMsg | Settle, p: Pass): Step<Turn> {
	const stepped = shipStep(t, m);
	if (stepped === null) return [t, []];
	const [ship, cmds] = stepped;
	if (ship.phase !== "over")
		return [
			{...t, ship, phases: ship.phase === t.ship.phase ? t.phases : [...t.phases, ship.phase]},
			cmds,
		];
	const {fact, after} = shipLine(ship.outcome, t.on);
	return recording(t, p, `the ship machine's \`${nameOf(ship.outcome)}\``, fact, after);
}

// ---------------------------------------------------------------- the ship stage, handed to the ship program

/**
 * Ask the ship program to ship the task's pull request. The ask's id is the
 * intent, named from where the turn stands in the run: the same turn asks
 * under the same id after a restart, and a later turn on the same task under
 * a new one.
 */
function handed(t: Of, p: Pass): Step<Turn> {
	if (t.pr === null) return stop(t, `the lane is at \`${t.state}\` and names no pull request`);
	const asked = askShip({
		key: t.task,
		lane: p.lane,
		task: t.task,
		pr: t.pr,
		intent: intentOf(p.run, p.pass, t.task, "ship"),
	});
	return [{...of(t), phase: "handed", on: t.pr, asked}, [asked]];
}

/** The program's answer to this turn's ask, or `null` when the Msg is not that. An answer to another ask is not this turn's. */
function answerOf(t: Extract<Turn, {phase: "handed"}>, m: TurnMsg | Settle): Answer | null {
	if (m.type !== askShip.okType || !isSettle(m) || m.cmd.intent !== t.asked.intent) return null;
	return value<Answer>(m);
}

/** The ship program answered: its outcome is written as one line, as the child's is. */
function stepHanded(t: Extract<Turn, {phase: "handed"}>, m: TurnMsg | Settle, p: Pass): Step<Turn> {
	const answer = answerOf(t, m);
	if (answer === null) return [t, []];
	const {fact, after} = shipLine(answer.outcome, t.on);
	return recording(t, p, `the ship program's \`${answer.name}\``, fact, after);
}

/** One run of the ship machine, as the field log keeps it. */
export interface ShipRow {
	readonly task: string;
	readonly state: string;
	readonly pr: string;
	/** Each phase the child stood in, in order, `over` last. Empty when the ship program ran it: the operator saw only the answer. */
	readonly phases: readonly Ship["phase"][];
	/** How it ended, as the outcome is spelled. */
	readonly name: ShipName;
	readonly outcome: ShipOutcome;
}

/** The field log's row for the ship child this Msg ends, if it ends one. */
export function shippedOf(t: Turn, m: TurnMsg | Settle): ShipRow | null {
	if (t.phase === "handed") {
		const answer = answerOf(t, m);
		return answer === null
			? null
			: {
					task: t.task,
					state: t.state,
					pr: t.on,
					phases: [],
					name: answer.name,
					outcome: answer.outcome,
				};
	}
	if (t.phase !== "shipping") return null;
	const ship = shipStep(t, m)?.[0];
	if (ship === undefined || ship.phase !== "over") return null;
	return {
		task: t.task,
		state: t.state,
		pr: t.on,
		phases: [...t.phases, "over"],
		name: nameOf(ship.outcome),
		outcome: ship.outcome,
	};
}

function briefing(t: Of, p: Pass, route: ShellRoute): Step<Turn> {
	const asked = readBrief({key: t.task, lane: p.lane, task: t.task});
	return [{...of(t), phase: "briefing", route, asked}, [asked]];
}

/** One try of the park's recipe, named by its number on this turn. */
const unparkTry = (t: Of, p: Pass, tries: number): UnparkCmd =>
	unparkTask({
		key: t.task,
		lane: p.lane,
		task: t.task,
		intent: intentOf(p.run, p.pass, t.task, `unpark${tries}`),
	});

function unparking(t: Of, p: Pass, cause: ParkCause | null, tries: number): Step<Turn> {
	const asked = unparkTry(t, p, tries);
	return [{...of(t), phase: "unparking", cause, tries, asked}, [asked]];
}

/** remember: the recipe says it cleared the park; count that only once the lane shows it. */
function clearedBy(t: Of, p: Pass, asked: UnparkCmd): Step<Turn> {
	const [mem, cmds] = written(
		remember<Writes, ViewCmd>(asked, readLane({key: t.task, lane: p.lane}))[0],
	);
	return [{...of(t), phase: "recording", what: "the recipe's clearance", mem}, cmds];
}

/** A length of time in words, in the largest unit it fills: "12 hours", "5 minutes". */
function span(ms: number): string {
	const [n, unit] =
		ms >= 3_600_000 && ms % 3_600_000 === 0
			? [ms / 3_600_000, "hour"]
			: ms >= 60_000
				? [Math.round(ms / 60_000), "minute"]
				: [Math.max(1, Math.round(ms / 1_000)), "second"];
	return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/**
 * What a park waits on, said as the thing a person can do about it, from
 * what the turn already holds: the cause, the pull request, and whether the
 * park's recipe is tried on while the question is open. Where it is, doing
 * the thing is enough, and the question says so. `null`: the park's name is
 * all there is to say.
 */
function actFor(t: Of, cause: ParkCause | null, knobs: Knobs, rechecked: boolean): string | null {
	const often = `every ${span(knobs.recheckMs)} for the next ${span(knobs.askWaitMs)}`;
	const after = "After that the lane stays parked until someone starts it again.";
	if (cause === "awaiting-cp-approval" && t.pr !== null) {
		return [
			`To clear it: approve ${t.pr}.`,
			"The approval has to come from an owner of the files it changes who is not its author, on the pull request as it stands now.",
			...(rechecked
				? [
						"Approving is enough: you need not answer here.",
						`The machine looks for the approval ${often}, and carries on when it finds it.`,
						after,
					]
				: ["Then answer `/resume` here."]),
		].join(" ");
	}
	const lines = [
		...(t.pr === null ? [] : [`Its pull request is ${t.pr}.`]),
		...(rechecked
			? [
					`The machine checks ${often} whether this has cleared, and carries on when it has. No reply is needed for that.`,
					after,
				]
			: []),
	];
	return lines.length === 0 ? null : lines.join(" ");
}

/**
 * ask: post the question on the issue, and wait for a typed answer. `tried`:
 * how often the park's recipe has been asked so far, when it has one that is
 * worth asking again; `null` when it has none, and a reply is the only signal.
 */
function asking(
	t: Of,
	p: Pass,
	cause: ParkCause | null,
	why: string,
	tried: number | null,
): Step<Turn> {
	const act = actFor(t, cause, p.knobs, tried !== null);
	const text = [
		`The lane on ${p.issue} stopped at \`${t.state}\`${cause === null ? "" : ` (\`${cause}\`)`}. ${why}`,
		...(act === null ? [] : [act]),
		"The machine driving it cannot clear this itself, so it is waiting on you.",
	].join("\n\n");
	const question = {where: p.issue, text, who: p.knobs.who, floor: p.knobs.askFloor};
	// The question is named by the park (the lane, and how long its ledger was), not by the run:
	// a later run that meets the same park finds the question already asked, and reads the replies since.
	const [ask, cmds] = parkAsk.start(t.task, question, intentOf(p.lane, t.task, "ask", t.seq));
	const recheck: Recheck | null = tried === null ? null : {tries: tried, asked: null};
	return [{...of(t), phase: "asking", cause, ask, recheck}, cmds];
}

/** The Check behind a park's gate: code may clear it only when a known recipe covers its state and cause. */
const recipeGate = (t: TaskView): Gate<string> =>
	hasRecipe(t.state, t.cause)
		? pass
		: park(t.cause === null ? "The park says no cause." : "No known recipe clears this cause.");

/** gate on a park: passed, the recipe is tried; parked, it is a person's. */
function gatePark(t: TaskView, p: Pass): Step<Turn> {
	const gate = recipeGate(t);
	return gate.pass ? unparking(t, p, t.cause, 1) : asking(t, p, t.cause, gate.why, null);
}

/** Where a review stands before it is briefed: conflicting goes back to the build; unsettled waits. */
function settled(t: Of, p: Pass, route: ShellRoute, on: string, pr: PrState): Step<Turn> {
	if (pr.mergeable === "conflicting") {
		return recording(t, p, "a pull request that conflicts with its base", {
			kind: "base_conflicted",
			pr: on,
		});
	}
	if (pr.mergeable === "unknown" || pr.checks === "pending")
		return [{...of(t), phase: "pr_waiting", route, on}, []];
	return briefing(t, p, route);
}

/** Start a turn on one task: route by its state's name. */
export function startTurn(t: TaskView, p: Pass): Step<Turn> {
	const route = routeOf(t.state);
	if (route === null) return stop(t, `no route for the state \`${t.state}\``);
	switch (route.kind) {
		case "start":
			return recording(t, p, "the start of the build", {kind: "started"});
		case "shell": {
			// The ship stage, when the run was made to fill it with the ship machine: no shipper shell is started.
			if (route.shell === "shipper" && p.ship === "machine") return shipping(t, p);
			// Or with the ship program, asked: it keeps the machine, and the turn keeps only the ask.
			if (route.shell === "shipper" && p.ship === "program") return handed(t, p);
			if (!route.settled) return briefing(t, p, route);
			if (t.pr === null) return stop(t, `the lane is at \`${t.state}\` and names no pull request`);
			const asked = readPr({key: t.task, lane: p.lane, task: t.task, pr: t.pr});
			return [{...of(t), phase: "reading_pr", route, on: t.pr, asked}, [asked]];
		}
		case "queue":
			if (t.pr === null) return stop(t, `the lane is at \`${t.state}\` and names no pull request`);
			return [{...of(t), phase: "queued", pass: p.pass, on: t.pr}, []];
		case "park":
			return gatePark(t, p);
		case "final":
			return moved(t);
		case "unbuilt":
			return stop(t, route.why);
	}
}

/**
 * Whether the lane moved for this task since the turn began: the lane ended,
 * or the task's ledger grew (a new state, or a lap or a wait back into the same one).
 */
function hasMoved(view: LaneView, t: Of): boolean {
	const now = view.tasks.find((x) => x.task === t.task);
	return view.status !== "active" || now === undefined || now.seq > t.seq;
}

/** A refused brief: a rewind, a park to record, or a stop. */
function refused(t: Of, p: Pass, why: BriefRefusal): Step<Turn> {
	switch (why) {
		case "pr_repointed":
			return recording(t, p, "the rewind of a review whose pull request moved", {kind: "rewind"});
		case "size_stop":
			return recording(t, p, "the size stop", {
				kind: "park",
				cause: "size-stop",
				why: "the betting table's size stop",
			});
		case "no_issue":
		case "no_pr":
		case "branch_unclear":
			return recording(t, p, `a park (${why})`, {
				kind: "park",
				cause: null,
				why: `fabrika could not brief: ${why}`,
			});
		case "no_shell":
		case "stale_branch":
			return stop(t, `fabrika could not brief: ${why}`);
	}
}

const value = <V>(m: Settle) => (m as {readonly value: V}).value;

/** One Msg for one turn. */
export function stepTurn(t: Turn, m: TurnMsg | Settle, p: Pass): Step<Turn> {
	if (isSettle(m) && "error" in m) return failed(t, m, p);
	switch (t.phase) {
		case "recording":
			if (m.type === recordFact.okType || m.type === clearTask.okType) {
				if (value<boolean>(m as Settle) === false)
					return stop(t, `fabrika refused to record ${t.what}`);
				const [mem, cmds] = written(t.mem);
				return [{...t, mem}, cmds];
			}
			if (m.type === readLane.okType && t.mem.step === "reading") {
				if (!hasMoved(value<LaneView>(m as Settle), t))
					return stop(t, `${t.what} was recorded, and the lane did not move`);
				return t.after === undefined ? moved(t) : over(t, t.after);
			}
			return [t, []];
		case "shipping":
			return stepShip(t, m, p);
		case "handed":
			return stepHanded(t, m, p);
		case "reading_pr":
			return m.type === readPr.okType
				? settled(t, p, t.route, t.on, value<PrState>(m as Settle))
				: [t, []];
		case "pr_waiting":
			if (m.type === "pr_overdue" && m.seq === t.seq) {
				return stop(
					t,
					`the checks on ${t.on} did not settle in ${Math.round(p.knobs.ciWaitMs / 60_000)} minutes`,
				);
			}
			return m.type === "pr_read" ? settled(t, p, t.route, t.on, m.pr) : [t, []];
		case "briefing": {
			if (m.type !== readBrief.okType) return [t, []];
			const briefed = value<Briefed>(m as Settle);
			if (!briefed.ok) return refused(t, p, briefed.why);
			// The table and fabrika must name the same shell: a mismatch is two versions drifting apart.
			if (briefed.brief.shell !== t.route.shell) {
				return stop(
					t,
					`fabrika briefs \`${briefed.brief.shell}\` for \`${t.state}\`; the routing table says \`${t.route.shell}\``,
				);
			}
			const intent = intentOf(p.run, p.pass, t.task, "dispatched");
			const asked = markDispatched({
				key: t.task,
				lane: p.lane,
				task: t.task,
				shell: t.route.shell,
				intent,
			});
			return [
				{...of(t), phase: "dispatching", route: t.route, brief: briefed.brief, asked},
				[asked],
			];
		}
		case "dispatching": {
			if (m.type !== markDispatched.okType) return [t, []];
			// The conversation is named before the shell starts, from where it stands in the run.
			const id = intentOf(p.run, p.pass, t.task, "shell");
			const run: DraftRun = {
				key: t.task,
				id,
				prompt: t.brief.prompt,
				session: {id: sessionOf(id), continues: false},
				agent: `fabrika:${t.route.shell}`,
				folder: p.tree,
			};
			return [{...of(t), phase: "drafting", route: t.route, run, tools: 0}, []];
		}
		case "drafting":
			return drafting(t, m, p);
		case "confirming":
			if (m.type !== readLane.okType) return [t, []];
			if (hasMoved(value<LaneView>(m as Settle), t)) return moved(t);
			// The shell's own report did not land: write its last word, or that it gave none.
			return t.end === null
				? recording(t, p, "a shell that ended with no word", {
						kind: "shell_dead",
						why: "ended with no terminal word",
					})
				: recording(t, p, `the shell's \`${t.end.token}\``, {
						kind: "token",
						token: t.end.token,
						pr: t.end.pr,
					});
		case "queued":
			if (m.type === "queue_stalled" && m.pass === t.pass) {
				return recording(t, p, "a stalled merge queue", {kind: "queue", reading: "stalled"});
			}
			if (m.type !== "queue_read" || m.reading === "waiting") return [t, []];
			return recording(t, p, `the merge queue's \`${m.reading}\``, {
				kind: "queue",
				reading: m.reading,
			});
		case "unparking": {
			if (m.type !== unparkTask.okType) return [t, []];
			const answer = value<Unparked>(m as Settle);
			if (answer === "cleared") return clearedBy(t, p, t.asked);
			// Fabrika says no recipe covers this park after all: nothing to try again, and the question does not promise it.
			if (answer === "novel") return asking(t, p, t.cause, "Fabrika has no recipe for it.", null);
			// From here the recipe said "not yet", so it is tried on while a person is asked.
			if (t.cause !== null && PARK_ROUTE[t.cause] === "founder") {
				return asking(
					t,
					p,
					t.cause,
					"It waits on a call or an act only a person can make.",
					t.tries,
				);
			}
			if (t.tries > p.knobs.rechecks)
				return asking(t, p, t.cause, `Its recipe did not clear it in ${t.tries} tries.`, t.tries);
			return [{...of(t), phase: "rechecking", cause: t.cause, tries: t.tries}, []];
		}
		case "rechecking":
			return m.type === "recheck" && m.tries === t.tries
				? unparking(t, p, t.cause, t.tries + 1)
				: [t, []];
		case "asking":
			return stepAsk(t, m, p);
		case "over":
			return [t, []];
	}
}

/**
 * A Cmd that could not read or write at all stops the turn. Two do not: a
 * Judge, whose reply is set aside, and a try of the recipe made while a
 * question is open, which is taken for "not yet".
 */
function failed(t: Turn, m: Settle, p: Pass): Step<Turn> {
	// The ship child gives each of its own failed Cmds an ending: it is stepped, not stopped.
	if (t.phase === "shipping" && m.type.startsWith("ship_")) return stepShip(t, m, p);
	if (t.phase === "handed" && m.type === askShip.errType) {
		if (m.cmd.intent !== t.asked.intent) return [t, []];
		const why = (m.error as {readonly _tag?: string})._tag;
		return stop(
			t,
			why === "refused"
				? `the ship program would not take ${t.on}`
				: `the ship program ended before it answered on ${t.on}`,
		);
	}
	if (t.phase === "asking") {
		if (m.type === parkAsk.judge.ask.errType)
			return answered({...t, ask: parkAsk.unread(t.ask)}, p, []);
		if (m.type === parkAsk.post.errType)
			return stop(t, "the question to a person could not be posted");
		if (m.type === unparkTask.errType) return rechecked(t, m, null, p);
	}
	// The Judge and the recipe's try both belong to a question. Either can answer after the turn
	// has left it, because the other one settled it first: that late failure is nobody's to stop on.
	if (
		m.type === parkAsk.judge.ask.errType ||
		(m.type === unparkTask.errType && t.phase !== "unparking")
	)
		return [t, []];
	return stop(t, `\`${m.type.replace(/_err$/, "")}\` could not run`);
}

function drafting(t: Extract<Turn, {phase: "drafting"}>, m: TurnMsg | Settle, p: Pass): Step<Turn> {
	if (m.type === "shell_overtime") {
		return m.id === t.run.id
			? recording(t, p, "a shell that ran out of time", {
					kind: "shell_dead",
					why: `ran past ${t.route.minutes} minutes`,
				})
			: [t, []];
	}
	if (isSettle(m) || !("id" in m) || m.id !== t.run.id) return [t, []];
	const draft = m as ShellMsg;
	if (shellDraft.is.tool(draft)) return [{...t, tools: t.tools + 1}, []];
	if (shellDraft.is.failed(draft))
		return recording(t, p, "a shell that broke", {kind: "shell_dead", why: draft.error});
	const asked = readLane({key: t.task, lane: p.lane});
	return [
		{
			...of(t),
			phase: "confirming",
			end: (draft as Extract<ShellMsg, {output: unknown}>).output,
			asked,
		},
		[asked],
	];
}

function stepAsk(t: Extract<Turn, {phase: "asking"}>, m: TurnMsg | Settle, p: Pass): Step<Turn> {
	if (m.type === parkAsk.post.okType) {
		const {thread, at} = value<{thread: string; at: number}>(m as Settle);
		return [{...t, ask: parkAsk.posted(t.ask, thread, at)}, []];
	}
	if (m.type === "park_reply") {
		const [ask, cmds] = parkAsk.replied(t.ask, m.reply);
		return answered({...t, ask}, p, cmds);
	}
	if (m.type === parkAsk.judge.ask.okType && t.ask.phase === "reading") {
		const ruled = parkAsk.judge.rule(
			value<{choice: ParkChoice; confidence: number}>(m as Settle),
			t.ask.question.floor,
		);
		// gate on the Judge: a sure answer passes; an unsure one is set aside, and the ask waits on.
		const ask = gateJudge(ruled, parkAsk.judge.choices).pass
			? parkAsk.read(t.ask, ruled)
			: parkAsk.unread(t.ask);
		return answered({...t, ask}, p, []);
	}
	// The recipe's clock: try it again, unless a reply is being read. An answer is worth more than a try.
	if (m.type === "ask_recheck" && m.seq === t.seq) {
		const {recheck} = t;
		if (
			recheck === null ||
			recheck.asked !== null ||
			recheck.tries !== m.tries ||
			t.ask.phase !== "waiting"
		)
			return [t, []];
		const asked = unparkTry(t, p, recheck.tries + 1);
		return [{...t, recheck: {tries: recheck.tries + 1, asked, overdue: false}}, [asked]];
	}
	if (m.type === unparkTask.okType)
		return rechecked(t, m as Settle, value<Unparked>(m as Settle), p);
	if (m.type === "ask_overdue" && m.seq === t.seq && t.ask.phase === "waiting") {
		// A try of the recipe is in flight: let it answer first. A park it clears is no park to end on.
		if (t.recheck !== null && t.recheck.asked !== null)
			return [{...t, recheck: {...t.recheck, overdue: true}}, []];
		return unanswered(t, p);
	}
	return [t, []];
}

/** Nobody answered in time: the run ends parked. The question stays where it was posted. */
function unanswered(t: Extract<Turn, {phase: "asking"}>, p: Pass): Step<Turn> {
	const minutes = Math.round(p.knobs.askWaitMs / 60_000);
	return over(t, {
		kind: "parked",
		why: `nobody answered in ${minutes} minutes; the question is on ${p.issue}`,
	});
}

/**
 * A try of the recipe, made while the question is open, has answered.
 * `answer` is `null` when the try could not run at all.
 *
 * Cleared: the turn leaves the question and counts the clearance as the
 * gate's own try would. The question stays on the issue, and a reply that
 * comes later is read by nobody.
 *
 * Anything else changes nothing. "Not yet" is the usual answer. "No recipe
 * after all" and "could not run" are taken the same way, on purpose: before
 * this the machine waited on the person and tried nothing, and a try that
 * fails must not end a run that not trying would have left waiting. The
 * person is still asked, and the clock tries again.
 */
function rechecked(
	t: Extract<Turn, {phase: "asking"}>,
	m: Settle,
	answer: Unparked | null,
	p: Pass,
): Step<Turn> {
	const {recheck} = t;
	// Only the try in flight counts: an answer to an earlier one is late.
	if (recheck === null || recheck.asked === null || m.cmd.intent !== recheck.asked.intent)
		return [t, []];
	if (answer === "cleared") return clearedBy(t, p, recheck.asked);
	const waiting = {...t, recheck: {tries: recheck.tries, asked: null}};
	// What was held back while the try was in flight: a person's answer first, then the wait that ran out.
	if (waiting.ask.phase === "answered") return answered(waiting, p, []);
	return recheck.overdue && waiting.ask.phase === "waiting"
		? unanswered(waiting, p)
		: [waiting, []];
}

/**
 * Once the person's answer is read, act on it: leave the park, or clear it
 * on their word. With a try of the recipe in flight the answer is held until
 * the try has answered, so the recipe and the person never both write the
 * same clearance: fabrika would take the first and refuse the second.
 */
function answered(
	t: Extract<Turn, {phase: "asking"}>,
	p: Pass,
	cmds: readonly OperatorCmd[],
): Step<Turn> {
	const {ask} = t;
	if (ask.phase !== "answered" || (t.recheck !== null && t.recheck.asked !== null))
		return [t, cmds];
	if (ask.choice === "leave")
		return over(t, {kind: "parked", why: `a person said to leave it: ${ask.reply.body}`});
	const write = clearTask({
		key: t.task,
		lane: p.lane,
		task: t.task,
		said: ask.reply.body,
		grant: ask.choice === "more",
		intent: intentOf(p.run, p.pass, t.task, "clear"),
	});
	const [mem, first] = remember<Writes, ViewCmd>(write, readLane({key: t.task, lane: p.lane}));
	return [{...of(t), phase: "recording", what: "a person's clearance", mem}, first];
}

/** What a turn waits on, to be sent again after a restart. Subs reopen on their own. */
export function turnInFlight(t: Turn): readonly OperatorCmd[] {
	switch (t.phase) {
		case "recording":
			return [inFlight(t.mem)];
		case "reading_pr":
		case "briefing":
		case "dispatching":
		case "confirming":
		case "unparking":
		// The ask, under the same id: the program answers it from what it kept, or runs it on from where it stood.
		case "handed":
			return [t.asked];
		case "shipping":
			// The child's Cmd in flight, with the intent it was first sent under. Its Listens reopen on their own.
			return "asked" in t.ship ? [t.ship.asked] : [];
		case "asking": {
			const asked = parkAsk.asked(t.ask);
			const tried = t.recheck === null ? null : t.recheck.asked;
			return [...(asked === null ? [] : [asked]), ...(tried === null ? [] : [tried])];
		}
		default:
			return [];
	}
}

// ---------------------------------------------------------------- what a turn listens to

/** A clock, as a turn asks for one: how long, and the Msg it sends when it runs out. */
export interface Clock {
	readonly ms: number;
	readonly msg: TurnMsg;
}

/**
 * The second clock of an open question: the next try of the park's recipe.
 * Beside {@link timerOf}, which gives the question its limit, because the two
 * run at once (Elm's `Sub.batch` of two `Time.every`). Off while a try is in
 * flight, and while a reply is being read. Its Msg names the tries made, so
 * each try sets a new clock.
 */
export function recheckOf(t: Turn, knobs: Knobs): Clock | null {
	if (
		t.phase !== "asking" ||
		t.recheck === null ||
		t.recheck.asked !== null ||
		t.ask.phase !== "waiting"
	)
		return null;
	return {
		ms: knobs.recheckMs,
		msg: {type: "ask_recheck", key: t.task, seq: t.seq, tries: t.recheck.tries},
	};
}

/**
 * The clock a turn's phase waits on: a shell's time limit, a recipe's next
 * try, a stalled queue, checks that never settle, a question nobody answers.
 */
export function timerOf(t: Turn, knobs: Knobs): Clock | null {
	switch (t.phase) {
		case "drafting":
			return {
				ms: t.route.minutes * knobs.msPerMinute,
				msg: {type: "shell_overtime", key: t.task, id: t.run.id},
			};
		case "rechecking":
			return {ms: knobs.recheckMs, msg: {type: "recheck", key: t.task, tries: t.tries}};
		case "queued":
			return {ms: knobs.queueStallMs, msg: {type: "queue_stalled", key: t.task, pass: t.pass}};
		case "pr_waiting":
			return {ms: knobs.ciWaitMs, msg: {type: "pr_overdue", key: t.task, seq: t.seq}};
		case "asking":
			return t.ask.phase === "waiting"
				? {ms: knobs.askWaitMs, msg: {type: "ask_overdue", key: t.task, seq: t.seq}}
				: null;
		default:
			return null;
	}
}

/** One shell run, as the field log keeps it. */
export interface ShellRow {
	readonly task: string;
	readonly state: string;
	readonly shell: Shell;
	/** `finished`: it ended on its own. `failed`: it broke. `overtime`: it ran past its time and was stopped. */
	readonly outcome: "finished" | "failed" | "overtime";
	readonly token: string | null;
	readonly why: string | null;
	readonly tools: number;
	readonly spend: Spend;
}

/** The field log's row for the shell this Msg ends, if it ends one. */
export function ranOf(t: Turn, m: TurnMsg | Settle): ShellRow | null {
	if (t.phase !== "drafting" || isSettle(m) || !("id" in m) || m.id !== t.run.id) return null;
	const row = {task: t.task, state: t.state, shell: t.route.shell, tools: t.tools};
	if (m.type === "shell_overtime") {
		const spend = {costUsd: 0, tokens: 0, context: 0, turns: 0, minutes: t.route.minutes};
		return {
			...row,
			outcome: "overtime",
			token: null,
			why: `ran past ${t.route.minutes} minutes`,
			spend,
		};
	}
	const draft = m as ShellMsg;
	if (shellDraft.is.finished(draft)) {
		return {
			...row,
			outcome: "finished",
			token: draft.output?.token ?? null,
			why: null,
			spend: draft.spend,
		};
	}
	if (shellDraft.is.failed(draft))
		return {...row, outcome: "failed", token: null, why: draft.error, spend: draft.spend};
	return null;
}
