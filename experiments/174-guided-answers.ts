// Experiment 174: where should the answer to a Cmd get chosen, in a property test? Draw time, fold
// time, or `fc.commands`? And can Effect's own generator carry it? This is today's version of the
// machines (`packages/pipeline`), the ship machine of experiments 120 and 121.
//
// Every route draws from the same small pool of Msgs, so only the route differs. Each break is
// planted in a copy of a machine. Its shortest list is proved by a search over every list (`bfs`).
//
// Run with
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 node experiments/174-guided-answers.ts [part]
// part: lines | check | fit | bridge | values | drops | shrink | effect | all (default all)
// SEEDS=<n> (default 10), ESEEDS=<n> (default 10) seeds per case. No model, no key, no network.
// Writes results/174-guided-answers.json (a part run alone writes results/174-<part>.json).

import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {applyCell, defineMachine} from "@demlik/tea";
import {Cmd as TeaCmd} from "@demlik/tea/effect";
import {foldEvents} from "@demlik/tea/pbt";
import type {ShipFacts} from "@kampus/pipeline/stages/ship/facts";
import {
	enqueue,
	finish,
	merge,
	readShipFacts,
	rerunChecks,
	ship,
} from "@kampus/pipeline/stages/ship/machine";
import {CRITERIA, metAt, ON_TIP} from "@kampus/pipeline/stages/ship/scripted";
import {Arbitrary, Effect, Schema} from "effect";
import * as fc from "fast-check";

// The machines here are many, so the script holds them loosely. The Msgs are plain data either way.
type Msg = {readonly type: string; readonly cmd?: Sent; readonly [key: string]: unknown};
type Sent = {readonly type: string; readonly [key: string]: unknown};
type Machine = any;
type State = any;

const SEEDS = Number(process.env.SEEDS ?? "10");
const ESEEDS = Number(process.env.ESEEDS ?? "10");
const seeds = (n: number) => Array.from({length: n}, (_, i) => 1740 + i);
/** As long as experiment 121's lists of Msgs. */
const LENGTH = 60;
/** Runs to search for a break before a seed counts as not found. */
const RUNS = Number(process.env.RUNS ?? "5000");
/** For a closer look: `ROUTES=F1,H CASES=S7 RUNS=100000`. A run with these writes its own file. */
const ONLY_ROUTES = process.env.ROUTES?.split(",") ?? null;
const ONLY_CASES = process.env.CASES?.split(",") ?? null;
const LIMIT_MS = 60_000;
const MAX_SHRINKS = 5_000;
const UNKNOWN = {_tag: "unknown" as const};

// ---- lines: track
interface Track {
	readonly state: State;
	readonly waiting: readonly Sent[];
}
const startOf = (m: Machine): Track => {
	const [state, cmds] = m.init(null, undefined);
	return {state, waiting: [...cmds]};
};
const key = (x: unknown) => JSON.stringify(x);
/** One step, and what still waits for an answer. A Cmd sent twice waits twice. */
const advance = (m: Machine, t: Track, msg: Msg): Track => {
	const [state, cmds] = applyCell(m, t.state, msg as never) as readonly [State, readonly Sent[]];
	const i = msg.cmd === undefined ? -1 : t.waiting.findIndex((c) => key(c) === key(msg.cmd));
	return {state, waiting: [...t.waiting.filter((_, j) => j !== i), ...cmds]};
};
// ---- end

// ---------------------------------------------------------------- the ship world

const PR = "P";
const readOf = (head: string, over: Partial<ShipFacts> = {}): ShipFacts => ({
	head,
	state: "open",
	ours: true,
	ticket: {id: "o/r#1", link: "closes_it"},
	approval: "not_needed",
	reviews: [{kind: "review-code", verdict: "passed"}],
	checks: "green",
	mergeable: "clean",
	comments: [],
	main: ON_TIP,
	criteria: CRITERIA,
	verdicts: metAt(head),
	...over,
});
const QUEUE = (head: string): readonly Msg[] => [
	{type: "ship_queue", pr: PR, head, reading: "landed", commit: `main-${head}`},
	{type: "ship_queue", pr: PR, head, reading: "ejected"},
];
const SHIP_OUTSIDE: readonly Msg[] = [
	{type: "start", pr: PR},
	{type: "resume"},
	...["A", "B"].flatMap((head): readonly Msg[] => [
		{type: "ship_checks", pr: PR, head},
		...QUEUE(head),
		{type: "ship_checks_overdue", pr: PR, head, wait: 1},
		{type: "ship_queue_overdue", pr: PR, head},
	]),
];
const headOf = (c: Sent) => (c.ready as {head: string}).head;
/** Every answer a Cmd of ship may get here. The first of each is what a shrink reaches for. */
const shipAnswers = (c: Sent): readonly Msg[] => {
	const cmd = c as never;
	switch (c.type) {
		case "ship_facts":
			return [
				...["A", "B"].map((h) => readShipFacts.ok(cmd, readOf(h), 0)),
				...["A", "B"].map((h) => readShipFacts.ok(cmd, readOf(h, {checks: "pending"}), 0)),
				...["A", "B"].map((h) => readShipFacts.ok(cmd, readOf(h, {checks: "red"}), 0)),
				readShipFacts.ok(cmd, readOf("A", {state: "closed"}), 0),
				readShipFacts.err(cmd, UNKNOWN, 0),
			] as never;
		case "ship_rerun_checks":
			return [
				rerunChecks.ok(cmd, [{run: 1, attempt: 1}], 0),
				rerunChecks.err(cmd, UNKNOWN, 0),
			] as never;
		case "ship_enqueue":
			return [
				...(["queued", "no_queue", "head_moved", "stale", "conflicts"] as const).map((v) =>
					enqueue.ok(cmd, v, 0),
				),
				enqueue.err(cmd, UNKNOWN, 0),
			] as never;
		case "ship_merge":
			return [
				merge.ok(cmd, {reading: "merged", commit: `main-${headOf(c)}`}, 0),
				...(["head_moved", "stale", "conflicts", "behind"] as const).map((reading) =>
					merge.ok(cmd, {reading}, 0),
				),
				merge.err(cmd, UNKNOWN, 0),
			] as never;
		case "ship_finish":
			return [finish.ok(cmd, null, 0), finish.err(cmd, UNKNOWN, 0)] as never;
		default:
			throw new Error(`no answers for ${c.type}`);
	}
};
/** The happy road only, for the "ready pull request lands" law: every answer lets it go on. */
const landAnswers = (c: Sent): readonly Msg[] => {
	const cmd = c as never;
	switch (c.type) {
		case "ship_facts":
			return ["A", "B"].map((h) => readShipFacts.ok(cmd, readOf(h), 0)) as never;
		case "ship_enqueue":
			return [enqueue.ok(cmd, "queued", 0), enqueue.ok(cmd, "no_queue", 0)] as never;
		case "ship_merge":
			return [merge.ok(cmd, {reading: "merged", commit: `main-${headOf(c)}`}, 0)] as never;
		case "ship_finish":
			return [finish.ok(cmd, null, 0)] as never;
		default:
			throw new Error(`no answers for ${c.type}`);
	}
};
const SHIP_TYPES = [
	"ship_facts",
	"ship_rerun_checks",
	"ship_enqueue",
	"ship_merge",
	"ship_finish",
] as const;

interface World {
	readonly outside: readonly Msg[];
	readonly answers: (c: Sent) => readonly Msg[];
	readonly types: readonly string[];
}
const SHIP_WORLD: World = {outside: SHIP_OUTSIDE, answers: shipAnswers, types: SHIP_TYPES};
const LAND_WORLD: World = {
	outside: [
		{type: "start", pr: PR},
		{type: "resume"},
		{type: "ship_queue", pr: PR, head: "A", reading: "landed", commit: "main-A"},
		{type: "ship_queue", pr: PR, head: "B", reading: "landed", commit: "main-B"},
	],
	answers: landAnswers,
	types: ["ship_facts", "ship_enqueue", "ship_merge", "ship_finish"],
};

// ---------------------------------------------------------------- a machine that keeps no Cmds

/**
 * `start` sends one Cmd per name at once. Its state holds only which were answered, never a Cmd, so
 * only the fold can say what is waiting. All good: it publishes, with one retry. Triage calls this
 * shape the general case of #745.
 */
const createFan = (names: readonly string[]) => {
	const Input = Schema.Struct({ticket: Schema.String});
	const asks = names.map((name) =>
		TeaCmd.define(name, {input: Input, ok: Schema.Null, err: ["unknown"]}),
	);
	const publish = TeaCmd.define("publish", {input: Input, ok: Schema.String, err: ["unknown"]});
	const ask = (name: string) => asks[names.indexOf(name)] as (typeof asks)[number];
	const go = {ticket: "T"};
	const over = (outcome: string) => ({phase: "over", outcome});
	const answered = (s: State, name: string, bad: boolean) => {
		if (s.phase !== "asking" || s.got.includes(name)) return [s, []];
		const next = {phase: "asking", got: s.got + name, bad: s.bad || bad};
		if (next.got.length < names.length) return [next, []];
		return next.bad ? [over("failed"), []] : [{phase: "publishing", tries: 0}, [publish(go)]];
	};
	const update: Record<string, (s: State, m: Msg) => unknown> = {
		start: (s) =>
			s.phase === "idle"
				? [{phase: "asking", got: "", bad: false}, asks.map((a) => a(go))]
				: [s, []],
		publish_ok: (s) => (s.phase === "publishing" ? [over("landed"), []] : [s, []]),
		publish_err: (s) => {
			if (s.phase !== "publishing") return [s, []];
			return s.tries === 0
				? [{phase: "publishing", tries: 1}, [publish(go)]]
				: [over("failed"), []];
		},
	};
	for (const name of names) {
		update[`${name}_ok`] = (s) => answered(s, name, false);
		update[`${name}_err`] = (s) => answered(s, name, true);
	}
	const machine = defineMachine({
		types: {model: {} as State, msg: {} as Msg, sub: {} as never, ctx: undefined},
		cmds: [...asks, publish],
		init: () => [{phase: "idle"}, []],
		update,
		subs: [],
	} as never);
	const answers = (c: Sent): readonly Msg[] => {
		const cmd = c as never;
		return (
			c.type === "publish"
				? [publish.ok(cmd, "x", 0), publish.err(cmd, UNKNOWN, 0)]
				: [ask(c.type).ok(cmd, null, 0), ask(c.type).err(cmd, UNKNOWN, 0)]
		) as never;
	};
	const world: World = {
		outside: [{type: "start"}],
		answers,
		types: [...names, "publish"],
	};
	return {machine, world, answered, over, publish, go};
};
const FAN = createFan(["a", "b", "c"]);
const FAN5 = createFan(["a", "b", "c", "d", "e"]);

// ---------------------------------------------------------------- the planted breaks

const planted = (real: Machine, swap: Record<string, (s: State, m: Msg) => unknown>): Machine => ({
	...real,
	update: {...real.update, ...swap},
});
const realShip = (ship as Machine).update;
/** `ship_finish_err` answered "done": the tidy-up's failure told as done. */
const S1 = planted(ship, {
	ship_finish_err: (s, m) => realShip.ship_finish_ok(s, m),
});
/** The moves cap at 2, not 3. */
const S2 = planted(ship, {
	ship_enqueue_ok: (s, m) =>
		s.phase === "enqueueing" && m.value === "head_moved" && s.moves >= 2
			? [
					{
						phase: "over",
						pr: s.pr,
						waits: s.waits,
						outcome: {kind: "stuck", why: "head_moving"},
					},
					[],
				]
			: realShip.ship_enqueue_ok(s, m),
});
/** The waits cap at 3, not 5. */
const S3 = planted(ship, {
	ship_facts_ok: (s, m) => {
		const [next, cmds] = realShip.ship_facts_ok(s, m);
		return s.phase === "reading" && next.phase === "waiting" && s.waited >= 3
			? [
					{
						phase: "over",
						pr: s.pr,
						waits: s.waits,
						outcome: {kind: "stuck", why: "checks_stuck"},
					},
					[],
				]
			: [next, cmds];
	},
});
/** A re-run forgets which head it was for, so red checks run again and again. */
const S4 = planted(ship, {
	ship_rerun_checks_ok: (s, m) => {
		const [next, cmds] = realShip.ship_rerun_checks_ok(s, m);
		return [next.phase === "waiting" ? {...next, rerunFor: null} : next, cmds];
	},
});
/** An old enqueue's answer taken for the new one: needs a Cmd sent twice, then the older answered. */
const S5 = planted(ship, {
	ship_enqueue_ok: (s, m) =>
		s.phase === "enqueueing"
			? realShip.ship_enqueue_ok(s, {...m, cmd: s.asked})
			: realShip.ship_enqueue_ok(s, m),
});
/** Thrown out of the queue, taken as landed. */
const S6 = planted(ship, {
	ship_queue: (s, m) =>
		m.reading === "ejected"
			? realShip.ship_queue(s, {...m, reading: "landed", commit: "ejected"})
			: realShip.ship_queue(s, m),
});
/** An old re-run's answer taken for the new one, same shape as S5 and one step longer. */
const S7 = planted(ship, {
	ship_rerun_checks_ok: (s, m) =>
		s.phase === "rerunning"
			? realShip.ship_rerun_checks_ok(s, {...m, cmd: s.asked})
			: realShip.ship_rerun_checks_ok(s, m),
});
/** Experiment 121's "a ready pull request lands", with one answer dropped. */
const L1 = planted(ship, {ship_merge_ok: (s) => [s, []]});
const L2 = planted(ship, {ship_finish_ok: (s) => [s, []]});
const realFan = FAN.machine as Machine;
/** The answer to `c` is lost: the run hangs with nothing waiting. */
const N1 = planted(realFan, {c_ok: (s) => [s, []]});
/** It publishes after two answers of three. */
const N2 = planted(realFan, {
	a_ok: (s) => twoIs(s, "a"),
	b_ok: (s) => twoIs(s, "b"),
	c_ok: (s) => twoIs(s, "c"),
});
function twoIs(s: State, name: string) {
	if (s.phase === "asking" && !s.got.includes(name) && s.got.length === 1 && !s.bad)
		return [{phase: "publishing", tries: 0}, [FAN.publish(FAN.go)]];
	return FAN.answered(s, name, false);
}
/** Only the order c, a, b breaks: one order in six. */
const N3 = planted(realFan, {
	b_ok: (s) =>
		s.phase === "asking" && s.got === "ca" ? [FAN.over("failed"), []] : FAN.answered(s, "b", false),
});
/** The last answer failing is missed, so a failed run publishes. */
const N4 = planted(realFan, {
	a_err: (s) => lastErr(s, "a"),
	b_err: (s) => lastErr(s, "b"),
	c_err: (s) => lastErr(s, "c"),
});
function lastErr(s: State, name: string) {
	return FAN.answered(s, name, !(s.phase === "asking" && s.got.length === 2));
}
/** A second retry where one is the limit: the deep end of the machine. */
const N5 = planted(realFan, {
	publish_err: (s) => (s.phase === "publishing" ? [s, [FAN.publish(FAN.go)]] : [s, []]),
});
/** Five in flight, and only the order e, d, c, b, a breaks: every pick but the last is far from 0. */
const N6 = planted(FAN5.machine as Machine, {
	a_ok: (s) =>
		s.phase === "asking" && s.got === "edcb"
			? [FAN5.over("failed"), []]
			: FAN5.answered(s, "a", false),
});

type Law = "same" | "end";
interface Case {
	readonly name: string;
	readonly what: string;
	readonly world: World;
	readonly real: Machine;
	readonly copy: Machine;
	readonly law: Law;
	/** The shortest list worked out by hand before running. `bfs` checks it; if they differ, `bfs` wins and the guess stays in the record. */
	readonly guess: number;
}
const shipCase = (name: string, what: string, copy: Machine, guess: number): Case => ({
	name,
	what,
	world: SHIP_WORLD,
	real: ship,
	copy,
	law: "same",
	guess,
});
const fanCase = (
	name: string,
	what: string,
	copy: Machine,
	guess: number,
	law: Law = "same",
): Case => ({
	name,
	what,
	world: FAN.world,
	real: realFan,
	copy,
	law,
	guess,
});
const CASES: readonly Case[] = [
	shipCase("S1", "finish error told as done", S1, 5),
	shipCase("S2", "moves cap at 2", S2, 7),
	shipCase("S3", "waits cap at 3", S3, 8),
	shipCase("S4", "re-run forgets its head", S4, 5),
	shipCase("S5", "old enqueue answer taken", S5, 6),
	shipCase("S6", "ejected taken as landed", S6, 4),
	shipCase("S7", "old re-run answer taken", S7, 7),
	{...shipCase("L1", "lands law, merge answer dropped", L1, 4), law: "end", world: LAND_WORLD},
	{...shipCase("L2", "lands law, finish answer dropped", L2, 5), law: "end", world: LAND_WORLD},
	fanCase("N1", "no Cmds in state: c's answer lost", N1, 4, "end"),
	fanCase("N2", "no Cmds in state: publishes after two", N2, 3),
	fanCase("N3", "no Cmds in state: only c, a, b breaks", N3, 4),
	fanCase("N4", "no Cmds in state: last error missed", N4, 4),
	fanCase("N5", "no Cmds in state: a second retry", N5, 6),
	{
		...fanCase("N6", "no Cmds in state: five in flight, one order of 120", N6, 6),
		world: FAN5.world,
		real: FAN5.machine,
	},
];

// ---------------------------------------------------------------- the laws

const see = (step: {readonly next: State; readonly cmds: readonly unknown[]}) =>
	key([step.next.phase, step.next.outcome ?? null, step.cmds]);
/**
 * `same`: the copy does what the real machine does, step by step, looking only at the phase, the
 * outcome and the Cmds. So a break in a counter shows only when the counter matters.
 * `end`: a run with nothing waiting has ended, unless it has not begun or sits in the queue. Checked
 * only at the end of the list, as "a run given every answer ends": a tail can hide it.
 * Returns the Msg index of the break, or null.
 */
const broke = (c: Case, msgs: readonly Msg[]): number | null => {
	if (c.law === "same") {
		const a = foldEvents(c.copy, undefined, null, msgs as never).steps;
		const b = foldEvents(c.real, undefined, null, msgs as never).steps;
		for (let i = 0; i < a.length; i++) {
			if (see(a[i] as never) !== see(b[i] as never)) return i;
		}
		return null;
	}
	let t = startOf(c.copy);
	for (const m of msgs) t = advance(c.copy, t, m);
	const {phase, outcome} = t.state;
	if (t.waiting.length > 0 || phase === "idle" || phase === "queued") return null;
	if (phase !== "over") return msgs.length - 1;
	return outcome === "failed" || outcome?.kind === "done" || outcome === "landed"
		? null
		: msgs.length - 1;
};

/** Answers in a list that answer no Cmd really sent and still waiting, by a replay of its own. */
const invalidIn = (c: Case, msgs: readonly Msg[]): number => {
	let t = startOf(c.copy);
	let bad = 0;
	for (const m of msgs) {
		if (m.cmd !== undefined && !t.waiting.some((w) => key(w) === key(m.cmd))) bad++;
		t = advance(c.copy, t, m);
	}
	return bad;
};

/** The true shortest list that breaks the law, by trying every list in order of length. */
const bfs = (c: Case, depth = 10, cap = 400_000) => {
	type Node = {readonly copy: Track; readonly real: State; readonly list: readonly Msg[]};
	let level: readonly Node[] = [{copy: startOf(c.copy), real: startOf(c.real).state, list: []}];
	const seen = new Set<string>();
	let nodes = 0;
	for (let d = 1; d <= depth; d++) {
		const next: Node[] = [];
		for (const n of level) {
			const cmds = [...new Map(n.copy.waiting.map((w) => [key(w), w])).values()];
			for (const msg of [...c.world.outside, ...cmds.flatMap((w) => c.world.answers(w))]) {
				const copy = advance(c.copy, n.copy, msg);
				const [real] = applyCell(c.real, n.real, msg as never) as readonly [State, unknown];
				const list = [...n.list, msg];
				if (broke(c, list) !== null) return {smallest: d, list, nodes};
				const id = key([copy.state, real, copy.waiting]);
				if (seen.has(id)) continue;
				seen.add(id);
				nodes++;
				if (nodes > cap) return {smallest: null, list: null, nodes};
				next.push({copy, real, list});
			}
		}
		level = next;
	}
	return {smallest: null, list: null, nodes};
};

// ---------------------------------------------------------------- the routes on fast-check

/** What a route hands the law. A real `arbGuidedSequence` returns only `msgs`; the rest is for counting. */
interface Drawn {
	readonly msgs: readonly Msg[];
	/** Items drawn, before any were dropped. */
	readonly raw: number;
	/** Items drawn as an answer. */
	readonly answers: number;
	/** Of those, the ones that fit no waiting Cmd. */
	readonly dropped: number;
}
interface Route {
	readonly name: string;
	readonly arb: (c: Case) => fc.Arbitrary<Drawn>;
}
const PICK = fc.nat(11);

// ---- lines: draw time
// One step per Msg, each drawn knowing what waits. A shrink of an early step redraws the rest.
const candidates = (c: Case, t: Track): fc.Arbitrary<Msg> => {
	const outside = fc.constantFrom(...c.world.outside);
	const answers = t.waiting.flatMap((w) => c.world.answers(w));
	return answers.length === 0
		? outside
		: fc.oneof(
				{weight: 1, arbitrary: outside},
				{weight: 2, arbitrary: fc.constantFrom(...answers)},
			);
};
const drawnList = (msgs: readonly Msg[]): Drawn => ({
	msgs,
	raw: msgs.length,
	answers: msgs.filter((m) => m.cmd !== undefined).length,
	dropped: 0,
});
const chainOf = (c: Case, t: Track, left: number): fc.Arbitrary<readonly Msg[]> =>
	left === 0
		? fc.constant([])
		: candidates(c, t).chain((m) =>
				chainOf(c, advance(c.copy, t, m), left - 1).map((rest) => [m, ...rest]),
			);
/** D1: how long first, then the steps. A shrink of the length redraws everything. */
const D1: Route = {
	name: "D1 draw, length first",
	arb: (c) =>
		fc
			.nat(LENGTH)
			.chain((n) => chainOf(c, startOf(c.copy), n))
			.map(drawnList),
};
const coinChain = (c: Case, t: Track, left: number): fc.Arbitrary<readonly Msg[]> =>
	left === 0
		? fc.constant([])
		: fc
				.tuple(fc.nat(LENGTH - 1), candidates(c, t))
				.chain(([more, m]) =>
					more === 0
						? fc.constant([])
						: coinChain(c, advance(c.copy, t, m), left - 1).map((rest) => [m, ...rest]),
				);
/** D2: a stop coin on every step, the kindest draw-time shape: a shrink can stop the list early. */
const D2: Route = {
	name: "D2 draw, stop coin",
	arb: (c) => coinChain(c, startOf(c.copy), LENGTH).map(drawnList),
};
/**
 * D3: D2, kinder still. A chain cannot delete a step, so its shrink pads the list with Msgs that do
 * nothing. This takes those out after the draw. It judges by the copy, so it also takes out an answer
 * the copy drops, which is the very break L1 and L2 plant: a known cost of the idea.
 */
const D3: Route = {
	name: "D3 draw, no-ops taken out",
	arb: (c) =>
		coinChain(c, startOf(c.copy), LENGTH).map((msgs) => {
			let t = startOf(c.copy);
			const kept: Msg[] = [];
			for (const m of msgs) {
				const prev = key(t.state);
				const fits = t.waiting.some((w) => key(w) === key(m.cmd));
				const left = t.waiting.length - (fits ? 1 : 0);
				const next = advance(c.copy, t, m);
				if (key(next.state) === prev && next.waiting.length <= left) continue;
				kept.push(m);
				t = next;
			}
			return drawnList(kept);
		}),
};
// ---- end

// ---- lines: fold time
// Blind events, drawn before anything runs. The fold reads each against what waits at that moment.
type Event =
	| {readonly k: "out"; readonly i: number}
	| {readonly k: "ans"; readonly t: number; readonly pick: number; readonly v: readonly number[]};
const resolve = (c: Case, events: readonly Event[], typed: boolean): Drawn => {
	let t = startOf(c.copy);
	const msgs: Msg[] = [];
	let answers = 0;
	let dropped = 0;
	for (const e of events) {
		if (e.k === "out") {
			const m = c.world.outside[e.i % c.world.outside.length] as Msg;
			msgs.push(m);
			t = advance(c.copy, t, m);
			continue;
		}
		answers++;
		const named = c.world.types[e.t % c.world.types.length];
		const can = typed ? t.waiting.filter((w) => w.type === named) : t.waiting;
		const cmd = can[e.pick % can.length];
		if (cmd === undefined) {
			dropped++;
			continue;
		}
		const pool = c.world.answers(cmd);
		// One value per Cmd type, as experiment 120 has it: a pick that moves does not change the rest.
		const v = e.v[c.world.types.indexOf(cmd.type)] ?? 0;
		const m = pool[v % pool.length] as Msg;
		msgs.push(m);
		t = advance(c.copy, t, m);
	}
	return {msgs, raw: events.length, answers, dropped};
};
const eventArb = (c: Case): fc.Arbitrary<Event> => {
	const v = fc.array(PICK, {minLength: c.world.types.length, maxLength: c.world.types.length});
	return fc.oneof(
		{weight: 1, arbitrary: fc.nat(c.world.outside.length - 1).map((i): Event => ({k: "out", i}))},
		{
			weight: 2,
			arbitrary: fc
				.tuple(fc.nat(c.world.types.length - 1), PICK, v)
				.map(([t, pick, v]): Event => ({k: "ans", t, pick, v})),
		},
	);
};
const eventsArb = (c: Case) => fc.array(eventArb(c), {maxLength: LENGTH, size: "max"});
/** F1: an answer is a blind pick among all that wait. */
const F1: Route = {
	name: "F1 fold, blind pick",
	arb: (c) => eventsArb(c).map((es) => resolve(c, es, false)),
};
/** F2: an answer names its Cmd type too, so it keeps its meaning when the list around it shrinks. */
const F2: Route = {
	name: "F2 fold, typed pick",
	arb: (c) => eventsArb(c).map((es) => resolve(c, es, true)),
};
// ---- end

// ---- lines: hybrid
// Drawn knowing what waits, as at draw time. Shrunk as a plain list and folded again, as at fold
// time. An answer whose Cmd is gone goes to another of its type, or falls out. The idea is in
// fast-check's issue 424.
type Kept =
	| {readonly k: "out"; readonly i: number}
	| {readonly k: "ans"; readonly cmd: Sent; readonly v: number};
class Guided extends fc.Arbitrary<Drawn> {
	readonly c: Case;
	constructor(c: Case) {
		super();
		this.c = c;
	}
	fold(kept: readonly Kept[]): fc.Value<Drawn> {
		const {c} = this;
		let t = startOf(c.copy);
		const msgs: Msg[] = [];
		const stays: Kept[] = [];
		for (const e of kept) {
			if (e.k === "out") {
				const m = c.world.outside[e.i] as Msg;
				msgs.push(m);
				stays.push(e);
				t = advance(c.copy, t, m);
				continue;
			}
			const cmd =
				t.waiting.find((w) => key(w) === key(e.cmd)) ??
				t.waiting.find((w) => w.type === e.cmd.type);
			if (cmd === undefined) continue;
			const pool = c.world.answers(cmd);
			const m = pool[e.v % pool.length] as Msg;
			msgs.push(m);
			stays.push({k: "ans", cmd, v: e.v});
			t = advance(c.copy, t, m);
		}
		return new fc.Value(
			{msgs, raw: msgs.length, answers: stays.filter((e) => e.k === "ans").length, dropped: 0},
			stays,
		);
	}
	generate(mrng: fc.Random): fc.Value<Drawn> {
		const {c} = this;
		let t = startOf(c.copy);
		const kept: Kept[] = [];
		const n = mrng.nextInt(0, LENGTH);
		for (let i = 0; i < n; i++) {
			if (t.waiting.length > 0 && mrng.nextInt(0, 2) > 0) {
				const cmd = t.waiting[mrng.nextInt(0, t.waiting.length - 1)] as Sent;
				const pool = c.world.answers(cmd);
				const v = mrng.nextInt(0, pool.length - 1);
				kept.push({k: "ans", cmd, v});
				t = advance(c.copy, t, pool[v] as Msg);
			} else {
				const at = mrng.nextInt(0, c.world.outside.length - 1);
				kept.push({k: "out", i: at});
				t = advance(c.copy, t, c.world.outside[at] as Msg);
			}
		}
		return this.fold(kept);
	}
	canShrinkWithoutContext(_: unknown): _ is Drawn {
		return false;
	}
	shrink(_: Drawn, context: unknown): fc.Stream<fc.Value<Drawn>> {
		const kept = context as readonly Kept[] | undefined;
		if (kept === undefined || kept.length === 0) return fc.Stream.nil();
		const fold = (k: readonly Kept[]) => this.fold(k);
		function* cuts() {
			for (let size = kept.length; size >= 1; size = size === 1 ? 0 : Math.ceil(size / 2)) {
				for (let from = kept.length - size; from >= 0; from -= size) {
					yield fold([...kept.slice(0, from), ...kept.slice(from + size)]);
				}
			}
			for (let i = 0; i < kept.length; i++) {
				const e = kept[i] as Kept;
				if (e.k === "out" ? e.i === 0 : e.v === 0) continue;
				const zero: Kept = e.k === "out" ? {...e, i: 0} : {...e, v: 0};
				yield fold([...kept.slice(0, i), zero, ...kept.slice(i + 1)]);
			}
		}
		return new fc.Stream(cuts());
	}
}
const H: Route = {name: "H draw, then fold on shrink", arb: (c) => new Guided(c)};
// ---- end

// ---- lines: commands
// `fc.commands`: the same blind events, each a command with a precondition. It knows which commands
// really ran, and a shrink drops the rest.
interface Model {
	track: Track;
	readonly log: Msg[];
	checks: number;
}
class Answer implements fc.Command<Model, unknown> {
	readonly c: Case;
	readonly e: Event;
	constructor(c: Case, e: Event) {
		this.c = c;
		this.e = e;
	}
	check(m: Readonly<Model>) {
		return this.e.k === "out" || m.track.waiting.length > 0;
	}
	run(m: Model) {
		const one = resolve({...this.c, copy: stuck(this.c.copy, m.track)}, [this.e], false)
			.msgs[0] as Msg;
		m.log.push(one);
		m.track = advance(this.c.copy, m.track, one);
	}
	toString() {
		return this.e.k;
	}
}
/** A machine whose `init` is where the model stands, so `resolve` reads one event against it. */
const stuck = (m: Machine, t: Track): Machine => ({...m, init: () => [t.state, t.waiting]});
const commandsArb = (c: Case) => {
	const out = eventArb(c).filter((e) => e.k === "out");
	const ans = eventArb(c).filter((e) => e.k === "ans");
	const of = (a: fc.Arbitrary<Event>) => a.map((e) => new Answer(c, e));
	// `fc.commands` has no weights: the answers are named twice, for the same one to two as the others.
	return fc.commands([of(out), of(ans), of(ans)], {maxCommands: LENGTH, size: "max"});
};
type Iter = Iterable<fc.Command<Model, unknown>>;
const modelFold = (c: Case, cmds: Iter): Drawn => {
	const model: Model = {track: startOf(c.copy), log: [], checks: 0};
	fc.modelRun(() => ({model, real: null}), cmds as never);
	// fast-check wraps each command; `cmd` is ours. Only an answer can fail its check.
	const all: readonly {readonly cmd: Answer}[] = [...cmds] as never;
	const answers = all.filter((w) => w.cmd.e.k === "ans").length;
	return {msgs: model.log, raw: all.length, answers, dropped: all.length - model.log.length};
};
/** C: as fast-check's docs have it. The value is its own iterable, not a list of Msgs. */
const C: Route = {
	name: "C fc.commands",
	arb: (c) => commandsArb(c) as never,
};
/** C2: the same inside a `map`, the only way it fits `fc.Arbitrary<readonly M[]>`. */
const C2: Route = {
	name: "C2 fc.commands in a map",
	arb: (c) => commandsArb(c).map((cmds) => modelFold(c, cmds as never)),
};
// ---- end

// ---- lines: unguided
// As experiment 121: every answer made up front from all the Cmds the machine can send here.
const everyCmd = (c: Case): readonly Sent[] => {
	const found = new Map<string, Sent>();
	const seen = new Set<string>();
	let level = [startOf(c.real)];
	for (let d = 0; d < 9 && level.length > 0; d++) {
		const next: Track[] = [];
		for (const t of level) {
			for (const w of t.waiting) found.set(key(w), w);
			const cmds = [...new Map(t.waiting.map((w) => [key(w), w])).values()];
			for (const m of [...c.world.outside, ...cmds.flatMap((w) => c.world.answers(w))]) {
				const n = advance(c.real, t, m);
				const id = key([n.state, n.waiting]);
				if (!seen.has(id) && seen.size < 60_000) {
					seen.add(id);
					next.push(n);
				}
			}
		}
		level = next;
	}
	return [...found.values()];
};
const forged = new Map<World, readonly Msg[]>();
const U: Route = {
	name: "U unguided, as 121",
	arb: (c) => {
		const all = forged.get(c.world) ?? everyCmd(c).flatMap((w) => c.world.answers(w));
		forged.set(c.world, all);
		return fc
			.array(
				fc.oneof(
					{weight: 1, arbitrary: fc.constantFrom(...c.world.outside)},
					{weight: 2, arbitrary: fc.constantFrom(...all)},
				),
				{maxLength: LENGTH, size: "max"},
			)
			.map((msgs) => {
				const answers = msgs.filter((m) => m.cmd !== undefined).length;
				return {msgs, raw: msgs.length, answers, dropped: invalidIn(c, msgs)};
			});
	},
};
// ---- end

const ROUTES: readonly Route[] = [U, D1, D2, D3, F1, F2, H, C, C2].filter(
	(r) => ONLY_ROUTES === null || ONLY_ROUTES.includes(r.name.split(" ")[0] as string),
);

// ---------------------------------------------------------------- one run of one route

interface Row {
	readonly law: string;
	readonly route: string;
	readonly seed: number;
	readonly found: boolean;
	/** Runs until the first failing list. */
	readonly runs: number | null;
	readonly first: number | null;
	/** Msgs in the shrunk list. */
	readonly length: number | null;
	/** Msgs up to and including the break. */
	readonly upto: number | null;
	readonly smallest: number | null;
	/** Items in the shrunk list before dropping. */
	readonly raw: number | null;
	/** Shrinks accepted, as the tool counts them. */
	readonly shrinks: number | null;
	/** Lists tried while shrinking. */
	readonly tried: number;
	readonly searchMs: number;
	readonly shrinkMs: number;
	/** Answers in the shrunk list that answer no Cmd really sent. */
	readonly invalid: number | null;
	readonly cut: boolean;
	/** The shrunk list, by Msg type, when it is short enough to read. */
	readonly list: readonly string[] | null;
}
const ms = (x: number) => Math.round(x * 10) / 10;
const showList = (list: readonly Msg[] | null | undefined) =>
	list?.map((m) => {
		const v = m.value;
		const said = typeof v === "string" ? `:${v}` : "";
		return `${m.type}${said}`;
	}) ?? null;
const shortList = (list: readonly Msg[] | null | undefined, seed: number) =>
	seed === 1740 && list !== null && list !== undefined && list.length <= 25 ? showList(list) : null;
/** The last shrunk list either runner saw: `values` reads the value out of it. */
let lastList: readonly Msg[] | null = null;

const runFc = (c: Case, smallest: number | null, route: Route, seed: number): Row => {
	const isCommands = route === C;
	let evals = 0;
	let firstEval: number | null = null;
	let firstAt = 0;
	let firstLength: number | null = null;
	let last: Drawn | null = null;
	const started = performance.now();
	const prop = fc.property(route.arb(c), (x: Drawn) => {
		evals++;
		const d = isCommands ? modelFold(c, x as never) : x;
		if (broke(c, d.msgs) === null) return true;
		if (firstEval === null) {
			firstEval = evals;
			firstAt = performance.now();
			firstLength = d.msgs.length;
		}
		last = d;
		return false;
	});
	const out = fc.check(prop, {
		numRuns: RUNS,
		seed,
		interruptAfterTimeLimit: LIMIT_MS,
		markInterruptAsFailure: false,
	});
	const ended = performance.now();
	const shrunk = last as Drawn | null;
	lastList = shrunk?.msgs ?? null;
	return {
		list: shortList(shrunk?.msgs, seed),
		law: c.name,
		route: route.name,
		seed,
		found: shrunk !== null,
		runs: firstEval,
		first: firstLength,
		length: shrunk?.msgs.length ?? null,
		upto: shrunk === null ? null : (broke(c, shrunk.msgs) as number) + 1,
		smallest,
		raw: shrunk?.raw ?? null,
		shrinks: shrunk === null ? null : out.numShrinks,
		tried: firstEval === null ? 0 : evals - firstEval,
		searchMs: ms((firstEval === null ? ended : firstAt) - started),
		shrinkMs: ms(firstEval === null ? 0 : ended - firstAt),
		invalid: shrunk === null ? null : invalidIn(c, shrunk.msgs),
		cut: out.interrupted,
	};
};

// ---------------------------------------------------------------- the routes on Effect

// ---- lines: effect
const eint = (max: number) =>
	Arbitrary.schema(Schema.Int.check(Schema.isBetween({minimum: 0, maximum: max})));
/** Effect's `size`. A list's length follows it; `drops` prints what comes out. */
const ESIZE = 100;
const eventEffect = (c: Case) =>
	Arbitrary.map(
		Arbitrary.all({
			who: eint(2),
			i: eint(c.world.outside.length - 1),
			t: eint(c.world.types.length - 1),
			pick: eint(11),
			v: Arbitrary.all(c.world.types.map(() => eint(11))),
		}),
		(d): Event =>
			d.who === 0
				? {k: "out", i: d.i}
				: {k: "ans", t: d.t, pick: d.pick, v: d.v as readonly number[]},
	);
/** EF: Effect's array of blind events, folded in a map: 120's shape. */
const EF = (c: Case) =>
	Arbitrary.map(Arbitrary.array(eventEffect(c), {maxLength: LENGTH}), (es) =>
		resolve(c, es, false),
	);
/** ED: one step per Msg with `flatMap`, stop coin first. Effect keeps the choices of the rest when an early step shrinks. */
const edChain = (c: Case, t: Track, left: number): Arbitrary.Arbitrary<readonly Msg[]> =>
	left === 0
		? Arbitrary.Constant([])
		: Arbitrary.flatMap(Arbitrary.all({more: eint(LENGTH - 1), e: eventEffect(c)}), ({more, e}) => {
				if (more === 0) return Arbitrary.Constant([]);
				const one = resolve({...c, copy: stuck(c.copy, t)}, [e], false).msgs[0];
				if (one === undefined) return edChain(c, t, left - 1);
				return Arbitrary.map(edChain(c, advance(c.copy, t, one), left - 1), (rest) => [
					one,
					...rest,
				]);
			});
const ED = (c: Case) => Arbitrary.map(edChain(c, startOf(c.copy), LENGTH), drawnList);
// ---- end
const EFFECT_ROUTES = [
	{name: "EF Effect, fold", arb: EF},
	{name: "ED Effect, draw", arb: ED},
] as const;

const runEffect = (
	c: Case,
	smallest: number | null,
	route: (typeof EFFECT_ROUTES)[number],
	seed: number,
): Row => {
	const arb = route.arb(c);
	const started = performance.now();
	let runs = 0;
	while (runs < RUNS && performance.now() - started < LIMIT_MS) {
		const at = {size: ESIZE, seed: `${seed}:${runs++}`};
		const [d] = Effect.runSync(Arbitrary.sampleEffect(arb, {...at, count: 1}));
		if (d === undefined || broke(c, d.msgs) === null) continue;
		const firstAt = performance.now();
		let evals = 0;
		const r = Effect.runSync(
			Arbitrary.checkEffect(
				arb,
				(x) => {
					evals++;
					return broke(c, x.msgs) === null;
				},
				{...at, runs: 1, maxShrinks: MAX_SHRINKS},
			),
		);
		const ended = performance.now();
		const shrunk = r._tag === "Falsified" ? r.shrunkInput : d;
		lastList = shrunk.msgs;
		return {
			list: shortList(shrunk.msgs, seed),
			law: c.name,
			route: route.name,
			seed,
			found: true,
			runs,
			first: d.msgs.length,
			length: shrunk.msgs.length,
			upto: (broke(c, shrunk.msgs) as number) + 1,
			smallest,
			raw: shrunk.raw,
			shrinks: r._tag === "Falsified" ? r.shrinks : null,
			tried: evals,
			searchMs: ms(firstAt - started),
			shrinkMs: ms(ended - firstAt),
			invalid: invalidIn(c, shrunk.msgs),
			cut: false,
		};
	}
	lastList = null;
	return {
		list: null,
		law: c.name,
		route: route.name,
		seed,
		found: false,
		runs,
		first: null,
		length: null,
		upto: null,
		smallest,
		raw: null,
		shrinks: null,
		tried: 0,
		searchMs: ms(performance.now() - started),
		shrinkMs: 0,
		invalid: null,
		cut: false,
	};
};

// ---------------------------------------------------------------- the parts

const median = (xs: readonly number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length === 0 ? null : (s[Math.floor(s.length / 2)] as number);
};
const nums = (rows: readonly Row[], f: (r: Row) => number | null) =>
	rows.map(f).filter((x): x is number => x !== null);
const summary = (rows: readonly Row[]) => {
	const got = rows.filter((r) => r.found);
	return {
		seeds: rows.length,
		found: got.length,
		atSmallest: got.filter((r) => r.length === r.smallest).length,
		runs: median(nums(got, (r) => r.runs)),
		first: median(nums(got, (r) => r.first)),
		length: median(nums(got, (r) => r.length)),
		over: median(
			nums(got, (r) => (r.length === null || r.smallest === null ? null : r.length - r.smallest)),
		),
		maxOver: Math.max(
			0,
			...nums(got, (r) =>
				r.length === null || r.smallest === null ? null : r.length - r.smallest,
			),
		),
		upto: median(nums(got, (r) => r.upto)),
		raw: median(nums(got, (r) => r.raw)),
		shrinks: median(nums(got, (r) => r.shrinks)),
		tried: median(nums(got, (r) => r.tried)),
		searchMs: median(nums(rows, (r) => r.searchMs)),
		shrinkMs: median(nums(got, (r) => r.shrinkMs)),
		invalid: got.reduce((n, r) => n + (r.invalid ?? 0), 0),
		invalidLists: got.filter((r) => (r.invalid ?? 0) > 0).length,
		cut: rows.filter((r) => r.cut).length,
	};
};
const byRoute = (rows: readonly Row[]) => {
	const names = [...new Set(rows.map((r) => r.route))];
	return Object.fromEntries(names.map((n) => [n, summary(rows.filter((r) => r.route === n))]));
};
const table = (rows: readonly Row[]) => {
	const cases = [...new Set(rows.map((r) => r.law))];
	const routes = [...new Set(rows.map((r) => r.route))];
	for (const law of cases) {
		const smallest = rows.find((r) => r.law === law)?.smallest;
		console.log(`\n${law} (smallest ${smallest})`);
		for (const route of routes) {
			const s = summary(rows.filter((r) => r.route === route && r.law === law));
			console.log(
				`  ${route.padEnd(30)} found ${s.found}/${s.seeds} at-min ${s.atSmallest} len ${s.length} (+${s.maxOver} worst) upto ${s.upto} raw ${s.raw} shrinks ${s.shrinks} tried ${s.tried} search ${s.searchMs}ms shrink ${s.shrinkMs}ms invalid ${s.invalidLists} cut ${s.cut}`,
			);
		}
	}
	console.log("\nall cases");
	for (const route of routes) {
		const s = summary(rows.filter((r) => r.route === route));
		console.log(
			`  ${route.padEnd(30)} found ${s.found}/${s.seeds} at-min ${s.atSmallest} len ${s.length} over ${s.over} (worst +${s.maxOver}) raw ${s.raw} shrinks ${s.shrinks} tried ${s.tried} shrink ${s.shrinkMs}ms invalid-lists ${s.invalidLists} cut ${s.cut}`,
		);
	}
};

const smallestCache = new Map<string, ReturnType<typeof bfs>>();
const smallestOf = (c: Case) => {
	const known = smallestCache.get(c.name) ?? bfs(c);
	smallestCache.set(c.name, known);
	return known;
};

const partCheck = () => {
	const out = CASES.map((c) => {
		const found = smallestOf(c);
		return {
			case: c.name,
			what: c.what,
			guess: c.guess,
			smallest: found.smallest,
			nodes: found.nodes,
			list: showList(found.list),
		};
	});
	for (const r of out)
		console.log(
			`${r.case} guess ${r.guess} bfs ${r.smallest} (${r.nodes} states) ${r.what}: ${r.list?.join(" ")}`,
		);
	// The real machine must pass the law, or a route's failure means nothing.
	const control: Record<string, number> = {};
	for (const c of CASES) {
		const clean = {...c, copy: c.real};
		for (const route of [D2, F1, H]) {
			const r = runFcQuiet(clean, route);
			control[`${c.name} ${route.name}`] = r;
		}
	}
	const falseAlarms = Object.entries(control).filter(([, n]) => n > 0);
	console.log(
		`control: ${Object.keys(control).length} runs on the real machines, false alarms ${falseAlarms.length}`,
		falseAlarms,
	);
	return {cases: out, falseAlarms};
};
const runFcQuiet = (c: Case, route: Route) =>
	fc.check(
		fc.property(route.arb(c), (d: Drawn) => broke(c, d.msgs) === null),
		{numRuns: 300, seed: 174},
	).failed
		? 1
		: 0;

const partShrink = () => {
	const rows: Row[] = [];
	for (const c of CASES.filter((x) => ONLY_CASES === null || ONLY_CASES.includes(x.name))) {
		const {smallest} = smallestOf(c);
		for (const route of ROUTES) {
			for (const seed of seeds(SEEDS)) rows.push(runFc(c, smallest, route, seed));
		}
		console.error(`shrink ${c.name} done`);
	}
	table(rows);
	return {rows, routes: byRoute(rows)};
};

const partEffect = () => {
	const rows: Row[] = [];
	for (const c of CASES) {
		const {smallest} = smallestOf(c);
		for (const route of EFFECT_ROUTES) {
			for (const seed of seeds(ESEEDS)) rows.push(runEffect(c, smallest, route, seed));
		}
		console.error(`effect ${c.name} done`);
	}
	table(rows);
	return {rows, routes: byRoute(rows)};
};

/** How many drawn answers go to waste, on the real machines, with no break anywhere. */
const partDrops = () => {
	const worlds: readonly Case[] = [
		{...shipCase("ship", "", ship, 0)},
		{...fanCase("fan", "", realFan, 0)},
	];
	const out: Record<string, unknown> = {};
	for (const c of worlds) {
		const reachOf = (lists: readonly Drawn[]) => {
			let answers = 0;
			let dropped = 0;
			let acted = 0;
			let msgs = 0;
			let raw = 0;
			let deep = 0;
			let two = 0;
			let idle = 0;
			for (const d of lists) {
				answers += d.answers;
				dropped += d.dropped;
				raw += d.raw;
				msgs += d.msgs.length;
				let t = startOf(c.copy);
				let reached = false;
				let many = false;
				for (const m of d.msgs) {
					const prev = key(t.state);
					const fits = t.waiting.some((w) => key(w) === key(m.cmd));
					const left = t.waiting.length - (fits ? 1 : 0);
					t = advance(c.copy, t, m);
					// Acted: the state changed or a Cmd went out, as experiment 121 counts it.
					if (m.cmd !== undefined && (key(t.state) !== prev || t.waiting.length > left)) acted++;
					if (t.state.phase === "finishing" || t.state.phase === "publishing") reached = true;
					if (t.waiting.length > 1) many = true;
				}
				if (reached) deep++;
				if (many) two++;
				if (t.state.phase === "idle") idle++;
			}
			const n = lists.length;
			return {
				lists: n,
				raw: ms(raw / n),
				msgs: ms(msgs / n),
				answers: ms(answers / n),
				droppedPct: ms((100 * dropped) / Math.max(1, answers)),
				actedPct: ms((100 * acted) / Math.max(1, answers)),
				deepPct: ms((100 * deep) / n),
				twoWaitingPct: ms((100 * two) / n),
				neverStartedPct: ms((100 * idle) / n),
			};
		};
		for (const route of [U, D1, D2, D3, F1, F2, H, C2]) {
			const started = performance.now();
			const lists = fc.sample(route.arb(c), {numRuns: 1000, seed: 174});
			const r = {...reachOf(lists), msPerList: ms((performance.now() - started) / 1000)};
			out[`${c.name} ${route.name}`] = r;
			console.log(`${c.name} ${route.name.padEnd(30)}`, JSON.stringify(r));
		}
		for (const route of EFFECT_ROUTES) {
			const started = performance.now();
			const lists = Effect.runSync(
				Arbitrary.sampleEffect(route.arb(c), {count: 300, size: ESIZE, seed: "174"}),
			);
			const r = {...reachOf(lists), msPerList: ms((performance.now() - started) / 300)};
			out[`${c.name} ${route.name}`] = r;
			console.log(`${c.name} ${route.name.padEnd(30)}`, JSON.stringify(r));
		}
	}
	return out;
};

// ---- lines: values
// A real value, not a pool. Published ids of three letters or more break the copy, so the shortest
// list has 5 Msgs and the value the smallest has 3 letters. Each route gets its value another way.
const realPublish = realFan.update;
const VCASE: Case = {
	...fanCase(
		"V",
		"an id of 3 or more letters breaks it",
		planted(realFan, {
			publish_ok: (s, m) =>
				s.phase === "publishing" && String(m.value).length >= 3
					? [FAN.over("failed"), []]
					: realPublish.publish_ok(s, m),
		}),
		5,
	),
};
const idOf = (msgs: readonly Msg[]) =>
	msgs.find((m) => m.type === "publish_ok" && String(m.value).length >= 3)?.value as
		| string
		| undefined;
const withId = (m: Msg, id: string): Msg => (m.type === "publish_ok" ? {...m, value: id} : m);
const STRING = fc.string({maxLength: 30, size: "max"});
/** The Effect side of a value: drawn from the Cmd's own `ok` schema, with a length cap for this test. */
const ID_SCHEMA = Schema.String.check(Schema.isMaxLength(30));
const EID = Arbitrary.schema(ID_SCHEMA);
const sampleEffectValue = (seed: number, size = ESIZE) =>
	Effect.runSync(Arbitrary.sampleEffect(EID, {count: 1, size, seed: String(seed)}))[0] as string;
/** Fold time, with one value drawn per event before the fold. Any cell that does not look at the state fits here. */
const valueFold = (c: Case, valueArb: fc.Arbitrary<string>) =>
	fc.array(fc.tuple(eventArb(c), valueArb), {maxLength: LENGTH, size: "max"}).map((pairs) => {
		let t = startOf(c.copy);
		const msgs: Msg[] = [];
		for (const [e, id] of pairs) {
			const one = resolve({...c, copy: stuck(c.copy, t)}, [e], false).msgs[0];
			if (one === undefined) continue;
			const m = withId(one, id);
			msgs.push(m);
			t = advance(c.copy, t, m);
		}
		return drawnList(msgs);
	});
/**
 * Fold time with a cell that does look at the state, as #745's `(state, waiting)` has it. The fold
 * can only draw from it with a seed of its own, so all a shrink sees of the value is the seed.
 */
const insideFold = (seed: number): string => fc.sample(STRING, {numRuns: 1, seed})[0] as string;
const valueDraw = (c: Case, t: Track, left: number): fc.Arbitrary<readonly Msg[]> =>
	left === 0
		? fc.constant([])
		: fc.tuple(fc.nat(LENGTH - 1), candidates(c, t), STRING).chain(([more, one, id]) => {
				if (more === 0) return fc.constant([]);
				const m = withId(one, id);
				return valueDraw(c, advance(c.copy, t, m), left - 1).map((rest) => [m, ...rest]);
			});
const VALUE_ROUTES: readonly Route[] = [
	{name: "F1 fold, value before the fold", arb: (c) => valueFold(c, STRING)},
	{
		name: "F1 fold, cell drawn in the fold",
		arb: (c) => valueFold(c, fc.integer().map(insideFold)),
	},
	{name: "D2 draw", arb: (c) => valueDraw(c, startOf(c.copy), LENGTH).map(drawnList)},
	{
		name: "F1 fold, bridge from Effect",
		arb: (c) =>
			valueFold(
				c,
				fc.integer().map((s) => sampleEffectValue(s)),
			),
	},
];
const eValueFold = (c: Case) =>
	Arbitrary.map(
		Arbitrary.array(Arbitrary.all({e: eventEffect(c), id: EID}), {maxLength: LENGTH}),
		(pairs) => {
			let t = startOf(c.copy);
			const msgs: Msg[] = [];
			for (const {e, id} of pairs) {
				const one = resolve({...c, copy: stuck(c.copy, t)}, [e], false).msgs[0];
				if (one === undefined) continue;
				const m = withId(one, id);
				msgs.push(m);
				t = advance(c.copy, t, m);
			}
			return drawnList(msgs);
		},
	);
const eValueDraw = (c: Case, t: Track, left: number): Arbitrary.Arbitrary<readonly Msg[]> =>
	left === 0
		? Arbitrary.Constant([])
		: Arbitrary.flatMap(
				Arbitrary.all({more: eint(LENGTH - 1), e: eventEffect(c), id: EID}),
				({more, e, id}) => {
					if (more === 0) return Arbitrary.Constant([]);
					const one = resolve({...c, copy: stuck(c.copy, t)}, [e], false).msgs[0];
					if (one === undefined) return eValueDraw(c, t, left - 1);
					const m = withId(one, id);
					return Arbitrary.map(eValueDraw(c, advance(c.copy, t, m), left - 1), (rest) => [
						m,
						...rest,
					]);
				},
			);
const partValues = () => {
	const rows: (Row & {id: number | null})[] = [];
	const add = (r: Row, id: string | undefined) => rows.push({...r, id: id?.length ?? null});
	for (const route of VALUE_ROUTES) {
		for (const seed of seeds(SEEDS)) {
			const r = runFc(VCASE, 5, route, seed);
			add(r, idOf(lastList ?? []));
		}
	}
	for (const [name, arb] of [
		["EF Effect, fold", eValueFold(VCASE)],
		["ED Effect, draw", Arbitrary.map(eValueDraw(VCASE, startOf(VCASE.copy), LENGTH), drawnList)],
	] as const) {
		for (const seed of seeds(ESEEDS)) {
			const r = runEffect(VCASE, 5, {name: name as never, arb: () => arb as never}, seed);
			add(r, idOf(lastList ?? []));
		}
	}
	const names = [...new Set(rows.map((r) => r.route))];
	const out = names.map((n) => {
		const these = rows.filter((r) => r.route === n);
		return {
			route: n,
			...summary(these),
			id: median(these.map((r) => r.id).filter((x): x is number => x !== null)),
			idWorst: Math.max(0, ...these.map((r) => r.id ?? 0)),
			idAtThree: these.filter((r) => r.id === 3).length,
		};
	});
	for (const r of out)
		console.log(
			`V ${r.route.padEnd(34)} found ${r.found}/${r.seeds} len ${r.length} (+${r.maxOver} worst) id ${r.id} (worst ${r.idWorst}, at 3: ${r.idAtThree}) shrinks ${r.shrinks} tried ${r.tried} shrink ${r.shrinkMs}ms`,
		);
	return out;
};
// ---- end

// ---- lines: bridge
// The tiny test of #749's bridge: a fast-check arbitrary that gets its value from Effect's. fast-check
// sees only the seed, so does a shrink of the seed make the value smaller?
const Small = Schema.Struct({
	name: ID_SCHEMA,
	n: Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 1000})),
});
const SMALL = Arbitrary.schema(Small);
/** Holds until a name reaches 3 letters. The smallest failure is 3 letters and `n` 0. */
const FAILS = (v: {readonly name: string; readonly n: number}) => v.name.length < 3;
const sizeOf = (v: {readonly name: string; readonly n: number}) =>
	v.name.length + String(v.n).length;
const sampleSmall = (seed: number, size: number) =>
	Effect.runSync(Arbitrary.sampleEffect(SMALL, {count: 1, size, seed: String(seed)}))[0] as {
		readonly name: string;
		readonly n: number;
	};
const partBridge = () => {
	const rows: Record<
		string,
		{size: number; shrinks: number; tried: number; ms: number; name: number; n: number}[]
	> = {};
	const push = (
		route: string,
		r: {size: number; shrinks: number; tried: number; ms: number; name: number; n: number},
	) => {
		rows[route] = [...(rows[route] ?? []), r];
	};
	const viaFc = (
		route: string,
		arb: fc.Arbitrary<{readonly name: string; readonly n: number}>,
		seed: number,
	) => {
		let last: {readonly name: string; readonly n: number} | null = null;
		let tried = 0;
		const started = performance.now();
		const out = fc.check(
			fc.property(arb, (v) => {
				tried++;
				if (FAILS(v)) return true;
				last = v;
				return false;
			}),
			{seed, numRuns: 1000},
		);
		const v = last as {readonly name: string; readonly n: number} | null;
		if (v !== null)
			push(route, {
				size: sizeOf(v),
				shrinks: out.numShrinks,
				tried,
				ms: performance.now() - started,
				name: v.name.length,
				n: v.n,
			});
	};
	for (const seed of seeds(SEEDS)) {
		viaFc("fast-check's own", fc.record({name: fc.string({maxLength: 30}), n: fc.nat(1000)}), seed);
		viaFc(
			"bridge, a seed only",
			fc.integer().map((s) => sampleSmall(s, ESIZE)),
			seed,
		);
		viaFc(
			"bridge, a seed and a size",
			fc.tuple(fc.integer(), fc.integer({min: 1, max: ESIZE})).map(([s, z]) => sampleSmall(s, z)),
			seed,
		);
		const at = {size: ESIZE, seed: String(seed), runs: 1000, maxShrinks: MAX_SHRINKS};
		let tried = 0;
		const started = performance.now();
		const r = Effect.runSync(
			Arbitrary.checkEffect(
				SMALL,
				(v) => {
					tried++;
					return FAILS(v);
				},
				at,
			),
		);
		if (r._tag === "Falsified") {
			const v = r.shrunkInput;
			push("Effect's own", {
				size: sizeOf(v),
				shrinks: r.shrinks,
				tried,
				ms: performance.now() - started,
				name: v.name.length,
				n: v.n,
			});
		}
	}
	const started = performance.now();
	for (let i = 0; i < 300; i++) sampleSmall(i, ESIZE);
	const perSample = (performance.now() - started) / 300;
	const startedFc = performance.now();
	fc.sample(fc.record({name: fc.string({maxLength: 30}), n: fc.nat(1000)}), 3000);
	const perFc = (performance.now() - startedFc) / 3000;
	const out = Object.entries(rows).map(([route, rs]) => ({
		route,
		failed: rs.length,
		size: median(rs.map((r) => r.size)),
		sizeWorst: Math.max(...rs.map((r) => r.size)),
		name: median(rs.map((r) => r.name)),
		n: median(rs.map((r) => r.n)),
		shrinks: median(rs.map((r) => r.shrinks)),
		tried: median(rs.map((r) => r.tried)),
		ms: ms(median(rs.map((r) => r.ms)) ?? 0),
	}));
	for (const r of out) console.log(JSON.stringify(r));
	console.log(
		`one draw: Effect ${ms(perSample * 1000) / 1000} ms, fast-check ${ms(perFc * 1000) / 1000} ms`,
	);
	return {rows: out, msPerEffectDraw: perSample, msPerFcDraw: perFc};
};
// ---- end

/**
 * Does `fc.commands` fit `fc.Arbitrary<readonly M[]>`? Its value is its own iterable, so a `map` is
 * the only way to get a list out of it. Route C2 shrinks that map. The guess before running was that
 * the map would hide which commands ran: wrong, C and C2 shrink alike.
 */
const partFit = () => {
	const c = CASES.find((x) => x.name === "S1") as Case;
	const ran = (arb: fc.Arbitrary<unknown>) => {
		const seen: boolean[] = [];
		fc.check(
			fc.property(arb, () => {
				seen.push(true);
				return true;
			}),
			{numRuns: 5, seed: 174},
		);
		return seen.length;
	};
	const shape = (() => {
		const [one] = fc.sample(commandsArb(c), {numRuns: 1, seed: 174});
		return {
			isArray: Array.isArray(one),
			hasCloneMethod: fc.hasCloneMethod(one),
		};
	})();
	console.log("fc.commands value:", shape, "runs through a plain property:", ran(commandsArb(c)));
	return shape;
};

/** Lines of code per marked block of this script, not counting comments and blank lines. */
const partLines = () => {
	const counts: Record<string, number> = {};
	let block: string | null = null;
	for (const line of readFileSync(import.meta.filename, "utf8").split("\n")) {
		const start = /^\/\/ -{4} lines: (.+)$/.exec(line);
		if (start !== null) block = start[1] as string;
		else if (line.startsWith("// ---- end")) block = null;
		else if (block !== null && !/^\s*(\/\/|\/\*|\*|$)/.test(line))
			counts[block] = (counts[block] ?? 0) + 1;
	}
	console.log(counts);
	return counts;
};

const PARTS = {
	lines: partLines,
	check: partCheck,
	fit: partFit,
	bridge: partBridge,
	values: partValues,
	drops: partDrops,
	shrink: partShrink,
	effect: partEffect,
} as const;
const asked = process.argv[2] ?? "all";
const dir = `${import.meta.dirname}/results`;
mkdirSync(dir, {recursive: true});
const results: Record<string, unknown> = {
	seeds: SEEDS,
	effectSeeds: ESEEDS,
	length: LENGTH,
	runs: RUNS,
	pins: {tea: "0.21.0", effect: "4.0.6", "fast-check": "4.10.2"},
};
for (const [name, part] of Object.entries(PARTS)) {
	if (asked !== "all" && asked !== name) continue;
	console.log(`\n==== ${name}`);
	results[name] = part();
}
writeFileSync(
	`${dir}/${
		ONLY_ROUTES !== null || ONLY_CASES !== null
			? `174-${asked}-closer`
			: asked === "all"
				? "174-guided-answers"
				: `174-${asked}`
	}.json`,
	`${JSON.stringify(results)}\n`,
);
