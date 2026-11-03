import {applyCell, structuralHash, type TimerDeps} from "@demlik/tea";
import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	type Step,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import {asRng, backoffDelay} from "@demlik/tea/retry-backoff";
import type {MsgOf} from "@kampus/fabrika-old";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	attach,
	jitter,
	noteOf,
	POLICY,
	type Reconnect,
	type ReconnectCmd,
	type ReconnectMsg,
	reconnectMachine,
	restart,
	type Tried,
} from "./reconnect.ts";

// The laws of the app's reconnect (reconnect.ts), on tea's pbt, judged from the ticket and not
// from the code: when the link to the host drops, the app waits, tries again, and gives up five
// minutes after the link ended. A host of another version is never tried again, and a host that
// runs older code is stopped only when the person asks (tracker ticket 12).
//
// Two kinds of runs feed the laws:
//
//   lists   any Msgs in any order, as a broken world might send them: answers nobody asked for,
//           old timers, Try again and the restart at any time. The clock only moves on.
//   runs    the world as it is: the runtime answers each try and each pick once, fires each
//           timer it runs once, ends the link only while it is watched, and a timer it stops may
//           still have fired just before. The person presses Try again, and the restart, when
//           they like.
//
// The ticket's numbers are written out below, not read from POLICY, so a wrong POLICY fails here.

type Machine = typeof reconnectMachine;
type Msg = MsgOf<Machine>;
type ReStep = Step<Reconnect, Msg, ReconnectCmd>;
type JitterCmd = ReturnType<typeof jitter>;
type Timer = TimerDeps<ReconnectMsg>;

/** The longest wait the ticket allows. */
const MOST_WAIT = 30_000;
/** How long after the link ended the app gives up. */
const GIVE_UP = 5 * 60_000;
/** The ticket's bound on a wait after `failures` failures in a row: min(30 s, 0.25 s * 2^failures). */
const boundFor = (failures: number) => Math.min(MOST_WAIT, 250 * 2 ** failures);

const ctx = stubCtxThrowingProxy<undefined>();
const same = (a: unknown, b: unknown) => structuralHash(a) === structuralHash(b);
const malformed = {_tag: "malformed_result", issues: []} as const;

const isTimer = (deps: unknown): deps is Timer =>
	typeof deps === "object" && deps !== null && "ms" in deps && "msg" in deps;
/** The subs `machine` asks for in `s`: the link's deps and the timer's, each null when off. */
const subsOf = (machine: Machine, s: Reconnect) => {
	const deps = (type: string) => machine.subs?.find((sub) => sub.type === type)?.deps(s) ?? null;
	const timer = deps("timer");
	return {link: deps("link"), timer: isTimer(timer) ? timer : null};
};

// ---------------------------------------------------------------- lists: any Msgs

const why = fc.constantFrom("the socket closed", "EPIPE");
/** What a try came to, mostly a failure, so lists reach long waits and the five minutes. */
const tried: fc.Arbitrary<Tried> = fc.oneof(
	{arbitrary: why.map((w) => ({kind: "lost", why: w}) as const), weight: 24},
	{arbitrary: fc.constant({kind: "up"} as const), weight: 2},
	{arbitrary: fc.constant({kind: "version", theirs: 2, ours: 1} as const), weight: 1},
	{
		arbitrary: fc
			.constantFrom("0ld0ld0ld0ld", null)
			.map((theirs) => ({kind: "build", theirs, ours: "n3wn3wn3wn3w"}) as const),
		weight: 1,
	},
);
const attempt = fc.integer({min: 0, max: 5});
/** A pick the jitter Cmd's answer lets through: 0 to 30 s. Any other comes back as jitter_err. */
const pick = fc.oneof(
	fc.double({min: 0, max: MOST_WAIT, noNaN: true}),
	fc.constantFrom(0, MOST_WAIT),
);

/** One entry per Msg type, the Cmds' answers too: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	ended: arbRecordMsg("ended", {why, at: fc.constant(0)}),
	due: arbRecordMsg("due", {attempt}),
	again: arbConstantMsg("again"),
	restart: arbConstantMsg("restart"),
	attach_ok: tried.map((t) => attach.ok(attach({}), t, 0)),
	attach_err: fc.constant({type: attach.errType, cmd: attach({}), error: malformed, at: 0}),
	restart_ok: tried.map((t) => restart.ok(restart({}), t, 0)),
	restart_err: fc.constant({type: restart.errType, cmd: restart({}), error: malformed, at: 0}),
	jitter_ok: fc.tuple(attempt, pick).map(([n, ms]) => jitter.ok(jitter({attempt: n}), ms, 0)),
	jitter_err: attempt.map((n) => ({
		type: jitter.errType,
		cmd: jitter({attempt: n}),
		error: malformed,
		at: 0,
	})),
};
/** Time between two Msgs: mostly short, sometimes a long silence, so lists cross five minutes. */
const gap = fc.oneof(
	{arbitrary: fc.nat({max: 3_000}), weight: 4},
	{arbitrary: fc.integer({min: 20_000, max: 120_000}), weight: 1},
);
/** Each Msg that carries a time gets the clock's, and the clock only moves on. */
const timed = (pairs: readonly (readonly [Msg, number])[]): readonly Msg[] => {
	let now = 0;
	return pairs.map(([msg, ms]) => {
		now += ms;
		return "at" in msg ? {...msg, at: now} : msg;
	});
};
const weights = {
	attach_ok: 6,
	jitter_ok: 4,
	due: 4,
	ended: 2,
	again: 1,
	attach_err: 1,
	restart: 1,
	restart_ok: 2,
	restart_err: 1,
};
const lists = fc
	.array(fc.tuple(arbMsg(table, {weights}), gap), {maxLength: 40, size: "max"})
	.map(timed);

// ---------------------------------------------------------------- runs: the world as it is

/** What the world does next, if it can now. */
type Choice =
	| {readonly do: "wait"; readonly ms: number}
	/** The try out comes back, or its answer does not read (`null`). */
	| {readonly do: "answer"; readonly tried: Tried | null}
	/** The pick out comes back, as main.ts picks it with this random number, or does not read. */
	| {readonly do: "pick"; readonly r: number | null}
	/** The timer that runs fires: the clock moves on by its wait. */
	| {readonly do: "fire"}
	/** A timer stopped before it fired had fired just before: its due comes now. */
	| {readonly do: "late"}
	/** The link that is watched ends. */
	| {readonly do: "end"; readonly why: string}
	| {readonly do: "again"}
	/** The person presses "Stop the old host and start this one". */
	| {readonly do: "restart"};

/** A try out: an attach, or a restart, which stops the old host and then attaches. */
type Out = "attach" | "restart";

interface World {
	/** The clock, from the app's start. */
	readonly now: number;
	/** Tries asked and not answered yet, the oldest first. */
	readonly tries: readonly Out[];
	/** Picks asked and not answered yet, the oldest first. */
	readonly picks: readonly JitterCmd[];
	/** The timer tea runs now, and whether it has fired. */
	readonly timer: {readonly deps: Timer; readonly fired: boolean} | null;
	/** The dues of timers stopped before they fired: each may still come, late. */
	readonly late: readonly Msg[];
	/** The link: not watched, watched, or watched and its one end already told. */
	readonly link: "off" | "on" | "ended";
}
const EMPTY: World = {now: 0, tries: [], picks: [], timer: null, late: [], link: "off"};

/** The world once `cmds` are asked for: each try and each pick is out until it is answered. */
const asked = (w: World, cmds: readonly ReconnectCmd[]): World => ({
	...w,
	tries: [...w.tries, ...cmds.flatMap((c) => (c.type === "jitter" ? [] : [c.type]))],
	picks: [...w.picks, ...cmds.flatMap((c) => (c.type === "jitter" ? [c] : []))],
});

/**
 * The world once tea has run the subs `machine` asks for in `s`: a sub whose deps stay the same
 * runs on, one whose deps change starts again, and one whose deps go is stopped.
 */
const subscribed = (machine: Machine, w: World, s: Reconnect): World => {
	const {link, timer} = subsOf(machine, s);
	const kept =
		w.timer !== null && timer !== null && structuralHash(w.timer.deps) === structuralHash(timer);
	const stopped = w.timer !== null && !kept && !w.timer.fired ? [w.timer.deps.msg] : [];
	return {
		...w,
		timer: kept ? w.timer : timer === null ? null : {deps: timer, fired: false},
		late: [...w.late, ...stopped],
		link: link === null ? "off" : w.link === "off" ? "on" : w.link,
	};
};

/** What the world sends for `c` now, and the world after; null when `c` cannot happen now. */
const sent = (w: World, c: Exclude<Choice, {do: "wait"}>): readonly [Msg, World] | null => {
	switch (c.do) {
		case "answer": {
			const [out, ...rest] = w.tries;
			if (out === undefined) return null;
			const after = {...w, tries: rest};
			if (out === "attach")
				return c.tried === null
					? [{type: attach.errType, cmd: attach({}), error: malformed, at: w.now}, after]
					: [attach.ok(attach({}), c.tried, w.now), after];
			return c.tried === null
				? [{type: restart.errType, cmd: restart({}), error: malformed, at: w.now}, after]
				: [restart.ok(restart({}), c.tried, w.now), after];
		}
		case "pick": {
			const [out, ...rest] = w.picks;
			if (out === undefined) return null;
			const after = {...w, picks: rest};
			if (c.r === null)
				return [{type: jitter.errType, cmd: out, error: malformed, at: w.now}, after];
			const r = c.r;
			// main.ts's own pick: backoffDelay(attempt, POLICY, Math.random).
			const ms = backoffDelay(
				out.attempt,
				POLICY,
				asRng(() => r),
			);
			return [jitter.ok(out, ms, w.now), after];
		}
		case "fire": {
			if (w.timer === null || w.timer.fired) return null;
			const now = w.now + w.timer.deps.ms;
			return [w.timer.deps.msg, {...w, now, timer: {...w.timer, fired: true}}];
		}
		case "late": {
			const [due, ...rest] = w.late;
			return due === undefined ? null : [due, {...w, late: rest}];
		}
		case "end":
			return w.link === "on"
				? [
						{type: "ended", why: c.why, at: w.now},
						{...w, link: "ended"},
					]
				: null;
		case "again":
			return [{type: "again"}, w];
		case "restart":
			return [{type: "restart"}, w];
	}
};

interface Moment {
	readonly step: ReStep;
	/** The world after the step, at the time the Msg came. */
	readonly world: World;
}
interface Run {
	readonly first: Reconnect;
	/** The world once init has run. */
	readonly start: World;
	readonly moments: readonly Moment[];
}

/** Run `machine` from its real init in the world, through `choices`. */
const simulate = (machine: Machine, choices: readonly Choice[]): Run => {
	const [first, cmds] = machine.init(null, ctx);
	const start = subscribed(machine, asked(EMPTY, cmds), first);
	const moments: Moment[] = [];
	let s = first;
	let w = start;
	for (const c of choices) {
		if (c.do === "wait") {
			w = {...w, now: w.now + c.ms};
			continue;
		}
		const out = sent(w, c);
		if (out === null) continue;
		const [msg, after] = out;
		const [next, made] = applyCell<Reconnect, Msg, ReconnectCmd>(machine, s, msg);
		w = subscribed(machine, asked(after, made), next);
		moments.push({step: {prev: s, msg, next, cmds: made}, world: w});
		s = next;
	}
	return {first, start, moments};
};

/** The world's silences: as often long as short, so most runs live past five minutes. */
const silence = fc.oneof(fc.nat({max: 3_000}), fc.integer({min: 20_000, max: 120_000}));
const choice: fc.Arbitrary<Choice> = fc.oneof(
	{arbitrary: silence.map((ms) => ({do: "wait", ms}) as const), weight: 3},
	{
		arbitrary: fc.option(tried, {freq: 8}).map((t) => ({do: "answer", tried: t}) as const),
		weight: 5,
	},
	{
		arbitrary: fc
			.option(fc.double({min: 0, max: 1, maxExcluded: true, noNaN: true}), {freq: 8})
			.map((r) => ({do: "pick", r}) as const),
		weight: 4,
	},
	{arbitrary: fc.constant({do: "fire"} as const), weight: 4},
	{arbitrary: fc.constant({do: "late"} as const), weight: 1},
	{arbitrary: why.map((w) => ({do: "end", why: w}) as const), weight: 2},
	{arbitrary: fc.constant({do: "again"} as const), weight: 1},
	{arbitrary: fc.constant({do: "restart"} as const), weight: 1},
);
const choices = fc.array(choice, {maxLength: 100, size: "max"});
/** The Msgs the world sends `machine`, for tea's pbt to fold again. */
const worldLists = (machine: Machine) =>
	choices.map((cs) => simulate(machine, cs).moments.map((m) => m.step.msg));

const OPTS = {numRuns: 300, seed: 1};

// ---------------------------------------------------------------- how a law is checked

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Machine) => void;
}

/** A law over each step, on lists and on runs. */
const everyStep = (name: string, holds: (step: ReStep, machine: Machine) => boolean): Law => ({
	name,
	check: (machine) => {
		for (const msgs of [lists, worldLists(machine)])
			propertyInvariant(machine, ctx, msgs, (step) => holds(step, machine), OPTS);
	},
});

/** A law over a whole list of steps, on lists and on runs. */
const everyTrace = (
	name: string,
	holds: (steps: readonly ReStep[], machine: Machine) => boolean,
): Law => ({
	name,
	check: (machine) => {
		for (const msgs of [lists, worldLists(machine)])
			propertyTrace(machine, ctx, msgs, (steps) => holds(steps, machine), OPTS);
	},
});

/** A law over the world itself, on runs only. */
const inTheWorld = (name: string, holds: (run: Run) => boolean): Law => ({
	name,
	check: (machine) =>
		fc.assert(
			fc.property(choices, (cs) => holds(simulate(machine, cs))),
			OPTS,
		),
});

/** Each state with the world it is in: the first, then after each step. */
const states = (run: Run) => [
	{s: run.first, w: run.start},
	...run.moments.map((m) => ({s: m.step.next, w: m.world})),
];

/** A failure the ticket counts: the link that was up ended, or the try out failed. */
const isFailure = ({prev, msg}: ReStep) =>
	(prev.at === "up" && msg.type === "ended") ||
	(prev.at === "attaching" &&
		(msg.type === "attach_err" || (msg.type === "attach_ok" && msg.value.kind === "lost"))) ||
	(prev.at === "restarting" &&
		(msg.type === "restart_err" || (msg.type === "restart_ok" && msg.value.kind === "lost")));
/** May the person restart the host in `s`? On a host of another version, or of another build. */
const restartable = (s: Reconnect) =>
	s.at === "refused" || (s.at === "up" && s.found.kind === "build");
/** The person's restart, where one is offered. */
const isRestart = ({prev, msg}: ReStep) => msg.type === "restart" && restartable(prev);
/** The attempts the step's picks are asked for. */
const picksOf = (cmds: readonly ReconnectCmd[]) =>
	cmds.flatMap((c) => (c.type === "jitter" ? [c.attempt] : []));
/** A failure that does not stop asks exactly one pick, for `n` failures in a row. */
const picksFor = (step: ReStep, n: number) =>
	step.next.at === "stopped" ? step.cmds.length === 0 : same(picksOf(step.cmds), [n]);
const isUp = ({prev, next}: ReStep) => prev.at !== "up" && next.at === "up";
const isAgain = ({prev, msg}: ReStep) => prev.at === "stopped" && msg.type === "again";

// ---------------------------------------------------------------- never wrong

const oneTryOut = inTheWorld(
	"at most one try is out at a time: the world never holds two tries unanswered, a restart counted as one",
	(run) => states(run).every(({w}) => w.tries.length <= 1),
);

const tryOnlyWhenNoneOut = everyStep(
	"a try is asked only on the way into attaching, a restart only on the way into restarting, one at a time, and each is left only on its own answer",
	({prev, msg, next, cmds}) =>
		(["attaching", "restarting"] as const).every((at) => {
			const cmd = at === "attaching" ? "attach" : "restart";
			const tries = cmds.filter((c) => c.type === cmd).length;
			const entering = prev.at !== at && next.at === at;
			const leaving = prev.at === at && next.at !== at;
			const answer = msg.type === `${cmd}_ok` || msg.type === `${cmd}_err`;
			return tries === (entering ? 1 : 0) && (!leaving || answer);
		}),
);

const waitsAtMost30 = everyStep(
	"every wait is at most 30 s: no wait is longer, and the timer is never set longer",
	({next}, machine) => {
		const {timer} = subsOf(machine, next);
		const wait = next.at === "waiting" ? next.wait : null;
		return (
			(wait === null || (wait >= 0 && wait <= MOST_WAIT)) &&
			(timer === null || (timer.ms >= 0 && timer.ms <= MOST_WAIT))
		);
	},
);

/**
 * When the current time without a link began: the app's start, the end of the link that was up,
 * or a Try again that acted. The machine may count from later (its first failed try), never earlier.
 */
const outagesOf = (run: Run) => {
	let from = 0;
	let ended: number | null = null;
	return run.moments.map((m) => {
		const {msg} = m.step;
		if (msg.type === "ended" && m.step.prev.at === "up") [from, ended] = [msg.at, msg.at];
		if (isAgain(m.step) || isRestart(m.step)) [from, ended] = [m.world.now, null];
		if (isUp(m.step)) ended = null;
		return {m, from, ended};
	});
};

const neverStopsEarly = inTheWorld(
	"it never stops before five minutes have passed since the link ended (or the app started, or Try again)",
	(run) =>
		outagesOf(run).every(
			({m, from}) =>
				m.step.prev.at === "stopped" ||
				m.step.next.at !== "stopped" ||
				m.world.now - from >= GIVE_UP,
		),
);

const stopsOnTime = inTheWorld(
	"after the link ended, the first try that fails five minutes or more after the end stops it, and nothing more is tried",
	(run) =>
		outagesOf(run).every(
			({m, ended}) =>
				ended === null ||
				m.step.prev.at !== "attaching" ||
				!isFailure(m.step) ||
				m.world.now - ended < GIVE_UP ||
				(m.step.next.at === "stopped" && m.step.cmds.length === 0),
		),
);

const refusedFinal = everyStep(
	"refused is left only by the person's restart: no other Msg leads out of it, or asks anything",
	({prev, msg, next, cmds}) =>
		prev.at !== "refused" || msg.type === "restart" || (same(next, prev) && cmds.length === 0),
);

const restartOnlyAsked = everyStep(
	"a restart is asked only by the person, on a host of another version or build, and that always restarts it",
	({prev, msg, next, cmds}) => {
		const restarts = cmds.filter((c) => c.type === "restart").length;
		if (msg.type === "restart" && restartable(prev))
			return next.at === "restarting" && same(cmds, [restart({})]);
		return restarts === 0 && (next.at !== "restarting" || prev.at === "restarting");
	},
);

const againOnlyStopped = everyStep(
	"Try again changes nothing unless it is stopped",
	({prev, msg, next, cmds}) =>
		msg.type !== "again" || prev.at === "stopped" || (same(next, prev) && cmds.length === 0),
);

const staleChangesNothing = everyTrace(
	"a stale due (not the running timer's) or a stale pick (not the one out) changes nothing",
	(steps, machine) => {
		// The pick out: the last one asked, until an answer for it comes.
		let out: JitterCmd | null = null;
		for (const {prev, msg, next, cmds} of steps) {
			let stale = false;
			if (msg.type === "due") stale = !same(msg, subsOf(machine, prev).timer?.msg ?? null);
			if (msg.type === "jitter_ok" || msg.type === "jitter_err") {
				stale = out === null || !same(msg.cmd, out);
				if (!stale) out = null;
			}
			if (stale && !(same(next, prev) && cmds.length === 0)) return false;
			for (const c of cmds) if (c.type === "jitter") out = c;
		}
		return true;
	},
);

const subsOnlyWhen = everyStep(
	"the link is watched only while up, and the timer runs only while waiting with a wait picked, for that wait",
	({next}, machine) => {
		const {link, timer} = subsOf(machine, next);
		const picked = next.at === "waiting" ? next.wait : null;
		return (
			(link !== null) === (next.at === "up") &&
			(picked === null ? timer === null : timer !== null && timer.ms === picked)
		);
	},
);

const refusedOnlyByHost = everyStep(
	"it is refused only when the try or restart out met another version, with both versions kept, and such a try always ends there",
	({prev, msg, next}) => {
		const answer =
			(prev.at === "attaching" && msg.type === "attach_ok") ||
			(prev.at === "restarting" && msg.type === "restart_ok")
				? msg.value
				: null;
		if (answer?.kind === "version")
			return next.at === "refused" && next.theirs === answer.theirs && next.ours === answer.ours;
		return next.at !== "refused" || prev.at === "refused";
	},
);

const stoppedStays = everyStep(
	"once stopped, it stays stopped and asks nothing until Try again",
	({prev, msg, next, cmds}) =>
		prev.at !== "stopped" || msg.type === "again" || (same(next, prev) && cmds.length === 0),
);

// ---------------------------------------------------------------- something good

/** Will something in the world move `s` on? Stopped and refused wait for nothing. */
const movesOn = (s: Reconnect, w: World): boolean => {
	switch (s.at) {
		case "attaching":
		case "restarting":
			return w.tries.length >= 1;
		case "waiting":
			return s.wait === null ? w.picks.length >= 1 : w.timer !== null && !w.timer.fired;
		case "up":
			return w.link === "on";
		case "stopped":
		case "refused":
			return true;
	}
};

const neverStalls = inTheWorld(
	"it never stalls: trying or restarting, a try is out; waiting for a pick, a pick is out; waiting, its timer runs and has not fired; up, the link is watched",
	(run) => states(run).every(({s, w}) => movesOn(s, w)),
);

const successResets = everyTrace(
	"a success resets the count: the first failure after the app's start, a success or a restart waits the shortest (attempt 1)",
	(steps) => {
		let fresh = true;
		for (const step of steps) {
			if (isUp(step) || isRestart(step)) fresh = true;
			if (isAgain(step)) fresh = false;
			if (!isFailure(step)) continue;
			if (fresh && !picksFor(step, 1)) return false;
			fresh = false;
		}
		return true;
	},
);

const againStartsOver = everyTrace(
	"Try again, while stopped, starts one try at once and a fresh count: the first failure after it waits the shortest",
	(steps) => {
		let fresh = false;
		for (const step of steps) {
			if (isUp(step) || isRestart(step)) fresh = false;
			if (isAgain(step)) {
				if (step.next.at !== "attaching" || !same(step.cmds, [attach({})])) return false;
				fresh = true;
			}
			if (!isFailure(step)) continue;
			if (fresh && !picksFor(step, 1)) return false;
			fresh = false;
		}
		return true;
	},
);

const ladder = everyTrace(
	"each failure in a row picks its wait one attempt higher, so the bound doubles up to 30 s",
	(steps) => {
		let last: number | null = null;
		for (const step of steps) {
			if (isUp(step) || isAgain(step) || isRestart(step)) last = null;
			if (!isFailure(step)) continue;
			const [asked] = picksOf(step.cmds);
			if (last !== null && step.next.at !== "stopped" && asked !== last + 1) return false;
			last = asked ?? null;
		}
		return true;
	},
);

const noteSays = everyTrace(
	"the window's note: what was found while up, nothing on the app's first try, reconnecting while it still tries, stopped once stopped, both versions when refused, and restarting while it restarts",
	(steps) => {
		let first = true;
		const says = (s: Reconnect) => {
			const note = noteOf(s);
			switch (s.at) {
				case "up":
					return same(note, s.found);
				case "attaching":
					return first ? note === null : note?.kind === "reconnecting" && note.why === s.why;
				case "waiting":
					return note?.kind === "reconnecting" && note.why === s.why;
				case "stopped":
					return note?.kind === "stopped" && note.why === s.why;
				case "refused":
					return same(note, {kind: "version", theirs: s.theirs, ours: s.ours});
				case "restarting":
					return same(note, {kind: "restarting"});
			}
		};
		const start = steps[0]?.prev;
		if (start !== undefined && !says(start)) return false;
		for (const step of steps) {
			// The app's first try lasts until the first Msg that changes anything.
			if (!same(step.next, step.prev)) first = false;
			if (!says(step.next)) return false;
		}
		return true;
	},
);

const LAWS = [
	oneTryOut,
	tryOnlyWhenNoneOut,
	waitsAtMost30,
	neverStopsEarly,
	stopsOnTime,
	refusedFinal,
	restartOnlyAsked,
	againOnlyStopped,
	staleChangesNothing,
	subsOnlyWhen,
	refusedOnlyByHost,
	stoppedStays,
	neverStalls,
	successResets,
	againStartsOver,
	ladder,
	noteSays,
];

/** The names of the laws `machine` breaks. */
const broken = (machine: Machine): readonly string[] =>
	LAWS.filter((law) => {
		try {
			law.check(machine);
			return false;
		} catch {
			return true;
		}
	}).map((law) => law.name);

// ---------------------------------------------------------------- planted mistakes

const real = reconnectMachine.update;
/** The real machine with one cell changed. */
const plant = (update: Partial<Machine["update"]>): Machine => ({
	...reconnectMachine,
	update: {...real, ...update},
});
const timerSubs = reconnectMachine.subs?.filter((sub) => sub.type === "timer") ?? [];
const linkSubs = reconnectMachine.subs?.filter((sub) => sub.type === "link") ?? [];
/** The real machine with its subs changed. */
const plantSubs = (subs: NonNullable<Machine["subs"]>): Machine => ({...reconnectMachine, subs});
/** When the failures in a row began, while a try is out after one. */
const originOf = (s: Reconnect) => {
	const from =
		s.at === "attaching" && "firstFailureAtMs" in s.retry ? s.retry.firstFailureAtMs : null;
	return typeof from === "number" ? from : null;
};
/** What the real machine does on a try that failed at `at`, from `s`. */
const lostFrom = (s: Reconnect, why: string, at: number) =>
	real.attach_ok(s, attach.ok(attach({}), {kind: "lost", why}, at));

const PLANTS = {
	/** Try again while a try is out starts another. */
	againWhileTrying: plant({
		again: (s, m) => (s.at === "attaching" ? [s, [attach({})]] : real.again(s, m)),
	}),
	/** A pick that did not read waits a minute. */
	waitsAMinute: plant({
		jitter_err: (s, m) => {
			const [next, cmds] = real.jitter_err(s, m);
			return [next !== s && next.at === "waiting" ? {...next, wait: 60_000} : next, cmds];
		},
	}),
	/** Each failed try counts as a minute later than it was. */
	stopsEarly: plant({attach_ok: (s, m) => real.attach_ok(s, {...m, at: m.at + 60_000})}),
	/** Each failed try counts as if it came when the tries began: they go on for ever. */
	neverStops: plant({
		attach_ok: (s, m) => real.attach_ok(s, {...m, at: originOf(s) ?? m.at}),
		attach_err: (s, m) => real.attach_err(s, {...m, at: originOf(s) ?? m.at}),
	}),
	/** A link end while refused starts the tries again. */
	refusedRetries: plant({
		ended: (s, m) => real.ended(s.at === "refused" ? {at: "up", found: {kind: "up"}} : s, m),
	}),
	/** A host of another version is restarted at once, unasked. */
	restartsUnasked: plant({
		attach_ok: (s, m) =>
			s.at === "attaching" && m.value.kind === "version"
				? [{at: "restarting"}, [restart({})]]
				: real.attach_ok(s, m),
	}),
	/** The restart is offered on a host of this build too. */
	restartsSameBuild: plant({
		restart: (s, m) => (s.at === "up" ? [{at: "restarting"}, [restart({})]] : real.restart(s, m)),
	}),
	/** A restart that failed keeps the count it had before the host was found. */
	restartKeepsCount: plant({
		restart_ok: (s, m) =>
			s.at === "restarting" && m.value.kind === "lost"
				? lostFrom({at: "attaching", retry: {attempt: 3}, why: null}, m.value.why, m.at)
				: real.restart_ok(s, m),
	}),
	/** Try again while waiting cuts the wait short. */
	againWhileWaiting: plant({
		again: (s, m) =>
			s.at === "waiting" ? real.again({at: "stopped", why: s.why}, m) : real.again(s, m),
	}),
	/** Any due counts while a wait is picked, an old one too. */
	staleDue: plant({
		due: (s, m) =>
			s.at === "waiting" && s.wait !== null
				? real.due(s, {...m, attempt: s.retry.attempt})
				: real.due(s, m),
	}),
	/** Any pick counts while waiting: an old one, or a second one. */
	stalePick: plant({
		jitter_ok: (s, m) => (s.at === "waiting" ? [{...s, wait: m.value}, []] : real.jitter_ok(s, m)),
	}),
	/** A link that ends after a success counts as the third failure. */
	keepsCount: plant({
		ended: (s, m) =>
			s.at === "up"
				? lostFrom({at: "attaching", retry: {attempt: 2}, why: null}, m.why, m.at)
				: real.ended(s, m),
	}),
	/** Every failed try picks for attempt 1: the waits never grow. */
	flatLadder: plant({
		attach_ok: (s, m) =>
			real.attach_ok(s.at === "attaching" ? {...s, retry: {...s.retry, attempt: 0}} : s, m),
	}),
	/** The link is watched while waiting too. */
	watchesWhileWaiting: plantSubs([
		{type: "link", deps: (s) => (s.at === "up" || s.at === "waiting" ? {up: true} : null)},
		...timerSubs,
	]),
	/** The timer runs before the wait is picked, set to nothing. */
	timerBeforePick: plantSubs([
		...linkSubs,
		{
			type: "timer",
			deps: (s) =>
				s.at === "waiting" ? {ms: s.wait ?? 0, msg: {type: "due", attempt: s.retry.attempt}} : null,
		},
	]),
	/** A link end waits, and forgets to ask for the pick. */
	forgetsToPick: plant({ended: (s, m) => [real.ended(s, m)[0], []]}),
	/** A try whose answer did not read is taken for another version. */
	refusesOnError: plant({
		attach_err: (s, m) =>
			s.at === "attaching" ? [{at: "refused", theirs: 0, ours: 1}, []] : real.attach_err(s, m),
	}),
	/** Try again does nothing. */
	againIgnored: plant({again: (s) => [s, []]}),
	/** Try again keeps an old count. */
	againKeepsCount: plant({
		again: (s, m) => {
			const [next, cmds] = real.again(s, m);
			return [
				s.at === "stopped" && next.at === "attaching" ? {...next, retry: {attempt: 4}} : next,
				cmds,
			];
		},
	}),
	/** Stopped, an old due starts the tries again. */
	stoppedRetriesAlone: plant({
		due: (s, m) =>
			s.at === "stopped"
				? [{at: "attaching", retry: {attempt: 0}, why: s.why}, [attach({})]]
				: real.due(s, m),
	}),
	/** A try after a wait forgets why the link ended, so the window says nothing. */
	forgetsWhy: plant({
		due: (s, m) => {
			const [next, cmds] = real.due(s, m);
			return [s.at === "waiting" && next.at === "attaching" ? {...next, why: null} : next, cmds];
		},
	}),
} satisfies Record<string, Machine>;

// ---------------------------------------------------------------- the tests

describe("the reconnect machine's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(reconnectMachine);
	});

	it("the runs reach every state and send every Msg, and many run past five minutes", () => {
		const runs = fc.sample(choices, OPTS).map((cs) => simulate(reconnectMachine, cs));
		const reached = new Set(runs.flatMap((run) => states(run).map(({s}) => s.at)));
		const sentTypes = new Set(runs.flatMap((run) => run.moments.map((m) => m.step.msg.type)));
		const stopped = runs.filter((run) => states(run).some(({s}) => s.at === "stopped"));
		const restarted = runs.filter((run) => run.moments.some((m) => isAgain(m.step)));
		expect([...reached].sort()).toEqual([
			"attaching",
			"refused",
			"restarting",
			"stopped",
			"up",
			"waiting",
		]);
		expect([...sentTypes].sort()).toEqual(Object.keys(table).sort());
		expect(stopped.length).toBeGreaterThan(OPTS.numRuns / 10);
		expect(restarted.length).toBeGreaterThan(OPTS.numRuns / 20);
	});

	it("each law is seen to fail on a planted mistake", () => {
		const caught = Object.fromEntries(
			Object.entries(PLANTS).map(([name, machine]) => [name, broken(machine)]),
		);
		expect(caught).toEqual({
			againWhileTrying: [oneTryOut.name, tryOnlyWhenNoneOut.name, againOnlyStopped.name],
			waitsAMinute: [waitsAtMost30.name],
			stopsEarly: [neverStopsEarly.name],
			neverStops: [stopsOnTime.name],
			// Waiting where it should be refused, a later failure counts on from that wait.
			refusedRetries: [refusedFinal.name, successResets.name],
			// Cutting a wait short also starts the five minutes and the count over, unasked.
			againWhileWaiting: [stopsOnTime.name, againOnlyStopped.name, ladder.name],
			staleDue: [staleChangesNothing.name],
			stalePick: [staleChangesNothing.name],
			keepsCount: [successResets.name],
			flatLadder: [ladder.name],
			watchesWhileWaiting: [subsOnlyWhen.name],
			// A pick of 0 ms then keeps the timer of 0 ms that already fired: nothing moves it on.
			timerBeforePick: [subsOnlyWhen.name, neverStalls.name],
			// With no pick asked, a pick nobody asked for is the only way on, and the machine takes it.
			forgetsToPick: [staleChangesNothing.name, neverStalls.name, successResets.name],
			// A try that did not read is a failure: it must wait and try again, not give up.
			refusesOnError: [
				stopsOnTime.name,
				refusedOnlyByHost.name,
				successResets.name,
				againStartsOver.name,
				ladder.name,
			],
			againIgnored: [againStartsOver.name],
			againKeepsCount: [againStartsOver.name],
			stoppedRetriesAlone: [staleChangesNothing.name, stoppedStays.name],
			forgetsWhy: [noteSays.name],
			// Stopping a host the person was never asked about: the restart's own law, and what it
			// takes from the failures that should have waited on the refusal instead.
			restartsUnasked: [
				stopsOnTime.name,
				restartOnlyAsked.name,
				refusedOnlyByHost.name,
				ladder.name,
			],
			restartsSameBuild: [restartOnlyAsked.name],
			restartKeepsCount: [successResets.name],
		});
		// Every law is caught by at least one plant.
		expect(LAWS.filter((law) => !Object.values(caught).flat().includes(law.name))).toEqual([]);
	});
});

describe("the wait main.ts picks, and what the machine takes back", () => {
	it("after n failures in a row, the pick lies between 0 and min(30 s, 0.25 s * 2^n), spread evenly over all of it (full jitter)", () => {
		fc.assert(
			fc.property(
				fc.integer({min: 1, max: 40}),
				fc.double({min: 0, max: 1, maxExcluded: true, noNaN: true}),
				(n, r) => {
					// main.ts's own pick: backoffDelay(attempt, POLICY, Math.random), with r for the random.
					const ms = backoffDelay(
						n,
						POLICY,
						asRng(() => r),
					);
					return ms >= 0 && ms <= boundFor(n) && Math.abs(ms - r * boundFor(n)) < 1e-6;
				},
			),
			OPTS,
		);
	});

	it("a pick outside 0 to 30 s does not read: it comes back as jitter_err, never as a wait", async () => {
		const reads = async (v: unknown) => {
			const answer = await jitter.schema.ok["~standard"].validate(v);
			return answer.issues === undefined;
		};
		const outside = [-1, -0.001, MOST_WAIT + 0.001, 60_000, Number.NaN, Infinity, -Infinity];
		expect(await Promise.all(outside.map(reads))).toEqual(outside.map(() => false));
		expect(await Promise.all([0, 1, 499.9, MOST_WAIT].map(reads))).toEqual([
			true,
			true,
			true,
			true,
		]);
	});
});
