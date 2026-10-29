// Experiment 166: how a job's record should keep a machine's steps. One row per Msg a machine
// folds, with the state after it: the whole state every time, or a JSON Patch (RFC 6902) of the
// state before with a whole state every N steps, the way a video keeps key frames. And what the
// record costs a run: how many writes, and how long each takes.
//
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 node experiments/166-step-size.ts
//
// Everything runs on the ledger's Miniflare twin in this process, through the door over HTTP, as
// a host on the laptop reaches it. Two workloads, each at N = 1 (every step whole), 5, 20, 100:
//
//   tally   `seq --to 3 | tally` and `seq --to 100 | tally`, the real programs. State {total}.
//   tracker 200 steps of a tracker-shaped state: 75 tickets of 4 entries each, then comments
//           land, tickets open and close, a search is typed, writes queue and land. The shape is
//           programs/tracker's `Tracker` and the pipeline's `Ticket`; the text is made up.
//   churn   200 steps of a 20 KB state where each step rewrites a fifth of it: patches' worst case.
//
// The record writes a patch until the patches since its last whole state would outweigh one
// (Mercurial's revlog rule), or after N of them. The first version wrote a whole state every N
// steps whatever the sizes; `simulated` runs both on the same steps here, and the record's own
// bytes must equal the simulated `bytes` rule's.
//
// Nothing is deployed and no model is called. $0. Node at the edge: the clock and the result file.
import {writeFileSync} from "node:fs";
import {performance} from "node:perf_hooks";
import {
	jobStorage,
	pipe,
	type RecordCalls,
	runTraceId,
	Shell,
	start,
	Traces,
} from "@kampus/fabrika";
import {layerTracesHttp, recordsHttp} from "@kampus/fabrika/http";
import {ledgerOptions, recordInside} from "@kampus/fabrika/local";
import {Effect, Layer, Redacted} from "effect";
import {Miniflare} from "miniflare";
// The patch maker is not a public name: it is the record's own part, read here to run the old
// rule beside the new one on the same steps.
import {diff, type Json} from "../packages/fabrika/src/program/json-patch.ts";

const LEDGER = "demo";
const KEYFRAMES = [1, 5, 20, 100] as const;
const door = Redacted.make(`fabrika_l_exp166-${Math.random().toString(36).slice(2)}`);
const programOf = (name: string) => {
	const found = Shell.SMALL.find((e) => e.program.name === name);
	if (found === undefined) throw new Error(`no small program ${name}`);
	return found.program;
};
const seq = programOf("seq");
const tally = programOf("tally");

type Timed = {readonly op: string; readonly ms: number};

/** `calls`, with each call's op and time kept in `log`. */
const timed =
	(calls: RecordCalls, log: Timed[]): RecordCalls =>
	(trace, call) => {
		const t0 = performance.now();
		return calls(trace, call).pipe(
			Effect.ensuring(Effect.sync(() => log.push({op: call.op, ms: performance.now() - t0}))),
		);
	};

/** `seq --to n | tally`, its runs kept in the record of its trace: every call it made. */
const tallyJob = (url: string, n: number) =>
	Effect.gen(function* () {
		const log: Timed[] = [];
		const first = `seq-to-${n}`;
		const trace = runTraceId(first);
		const calls = timed(yield* recordsHttp({url, ledger: LEDGER, token: door}), log);
		const storage = jobStorage(calls, trace);
		const t0 = performance.now();
		yield* Effect.gen(function* () {
			const counted = yield* start(tally, {}, {}, {id: `tally-of-${n}`, storage});
			if (counted.kind !== "running") return yield* Effect.die("tally did not start");
			const counting = yield* pipe(
				{program: seq, flags: {to: n}, keeping: {id: first, storage}},
				"n",
				counted,
				"add",
			);
			if (counting.kind !== "running") return yield* Effect.die("seq did not start");
			yield* counting.run.ended;
			yield* counted.run.ended;
		}).pipe(Effect.scoped);
		return {trace, log, wall: performance.now() - t0};
	}).pipe(Effect.scoped);

// ---------------------------------------------------------------- the tracker-shaped workload

const words = "the build is red on main again so the review waits for a fix from the agent".split(
	" ",
);
const textOf = (seed: number, length: number) => {
	let out = "";
	for (let i = 0; out.length < length; i++) out += `${words[(seed * 7 + i * 3) % words.length]} `;
	return out.slice(0, length);
};

type Entry = {
	pos: number;
	ticket: number;
	by: {kind: string; id: string};
	at: number;
	fact: unknown;
};
type Ticket = {number: number; title: string; state: "open" | "closed"; timeline: Entry[]};
type Tracker = {
	ready: boolean;
	load: "idle" | "busy" | "again";
	seen: number;
	tickets: Ticket[];
	open: number | null;
	saving: {id: string; write: unknown}[];
	failed: null;
	problems: string[];
	unreachable: null;
	quitting: boolean;
	show: "open" | "closed" | "all";
	find: string;
	pullRequests: {ask: "idle" | "busy"; list: null};
};

const AT = 1_761_000_000_000;
let pos = 0;
const entry = (ticket: number, fact: unknown): Entry => ({
	pos: ++pos,
	ticket,
	by: {kind: pos % 3 === 0 ? "agent" : "user", id: pos % 3 === 0 ? "builder" : "owner"},
	at: AT + pos * 1000,
	fact,
});

const firstTracker = (): Tracker => {
	pos = 0;
	const tickets: Ticket[] = [];
	for (let t = 1; t <= 75; t++) {
		const title = textOf(t, 40);
		tickets.push({
			number: t,
			title,
			state: t % 4 === 0 ? "closed" : "open",
			timeline: [
				entry(t, {type: "filed", title, body: textOf(t + 1, 300)}),
				entry(t, {type: "commented", body: textOf(t + 2, 160)}),
				entry(t, {type: "started", stage: "build"}),
				entry(t, {type: "commented", body: textOf(t + 3, 120)}),
			],
		});
	}
	return {
		ready: true,
		load: "idle",
		seen: pos,
		tickets,
		open: null,
		saving: [],
		failed: null,
		problems: [],
		unreachable: null,
		quitting: false,
		show: "open",
		find: "",
		pullRequests: {ask: "idle", list: null},
	};
};

/** Step `i`: one Msg the tracker could fold, and the state it leaves. Mostly loads that bring a comment. */
const stepOf = (s: Tracker, i: number): {msg: unknown; state: Tracker} => {
	const next = structuredClone(s);
	const k = (i * 13) % 75;
	const ticket = next.tickets[k] as Ticket;
	switch (i % 10) {
		case 0:
			next.open = ticket.number;
			return {msg: {type: "opened", n: ticket.number}, state: next};
		case 1:
			next.open = null;
			return {msg: {type: "back"}, state: next};
		case 2:
			next.find = textOf(i, 1 + (i % 6));
			return {msg: {type: "find", text: next.find}, state: next};
		case 3: {
			const write = {kind: "comment", ticket: ticket.number, body: textOf(i, 140)};
			next.saving.push({id: `w${i}`, write});
			return {msg: {type: "save", write}, state: next};
		}
		case 4:
			next.saving.shift();
			return {msg: {type: "saved", id: `w${i - 1}`}, state: next};
		case 5:
			ticket.state = ticket.state === "open" ? "closed" : "open";
			ticket.timeline.push(
				entry(ticket.number, {type: ticket.state === "open" ? "reopened" : "closed"}),
			);
			next.seen = pos;
			return {msg: {type: "loaded", entries: 1}, state: next};
		default:
			ticket.timeline.push(entry(ticket.number, {type: "commented", body: textOf(i, 140)}));
			next.seen = pos;
			next.load = i % 2 === 0 ? "idle" : "busy";
			return {msg: {type: "loaded", entries: 1}, state: next};
	}
};

type Steps = readonly {readonly msg: unknown; readonly state: unknown}[];

const trackerSteps = (): Steps => {
	let state = firstTracker();
	const out: {msg: unknown; state: Tracker}[] = [];
	for (let i = 0; i < 200; i++) {
		const step = stepOf(state, i);
		state = step.state;
		out.push(step);
	}
	return out;
};

/**
 * The worst case for patches: 50 slots of 400 characters (20 KB), and each step rewrites 10 of
 * them, so each patch is a fifth of the state. A form being typed into, a log tail kept in state.
 */
const churnSteps = (): Steps => {
	const slots = Array.from({length: 50}, (_, i) => textOf(i, 400));
	const out: {msg: unknown; state: {slots: string[]}}[] = [];
	for (let i = 0; i < 200; i++) {
		for (let j = 0; j < 10; j++) slots[(i * 7 + j * 5) % 50] = textOf(i * 10 + j, 400);
		out.push({msg: {type: "typed", i}, state: {slots: [...slots]}});
	}
	return out;
};

/** `steps`, each written as the storage writes a step: every call timed. */
const stepsJob = (url: string, name: string, steps: Steps) =>
	Effect.gen(function* () {
		const log: Timed[] = [];
		const trace = runTraceId(name);
		const calls = timed(yield* recordsHttp({url, ledger: LEDGER, token: door}), log);
		for (const [i, step] of steps.entries())
			yield* calls(trace, {
				op: "step",
				run: name,
				machine: "main",
				id: "main",
				at: AT + i,
				msg: step.msg,
				state: step.state,
				cmds: [],
			});
		return {trace, log};
	}).pipe(Effect.scoped);

/**
 * Both rules, run here on the same steps without a record: `count`, a whole state every
 * `keyframe` steps and a patch in between unless it is no smaller (the first version); `bytes`,
 * the record's rule (../packages/fabrika/src/host/job-rules.ts). `rebuild`: the most bytes read
 * to rebuild one step, its whole state and every patch after it.
 */
const simulate = (steps: Steps, keyframe: number, rule: "count" | "bytes") => {
	let bytes = 0;
	let fulls = 0;
	let rebuild = 0;
	let base = 0;
	let since = 0;
	let chain = 0;
	let before: Json | null = null;
	for (const [i, step] of steps.entries()) {
		const state = JSON.parse(JSON.stringify(step.state)) as Json;
		const whole = JSON.stringify(state).length;
		const patch =
			before === null || (rule === "count" ? i % keyframe === 0 : since + 1 >= keyframe)
				? null
				: JSON.stringify(diff(before, state)).length;
		const fits = patch !== null && (rule === "count" ? patch < whole : chain + patch < whole);
		if (fits) {
			bytes += patch;
			since += 1;
			chain += patch;
		} else {
			bytes += whole;
			fulls += 1;
			base = whole;
			since = 0;
			chain = 0;
		}
		rebuild = Math.max(rebuild, base + chain);
		before = state;
	}
	return {bytes, fulls, rebuild};
};

// ---------------------------------------------------------------- measure

const stats = (xs: readonly number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
	return {n: s.length, median: at(0.5), p95: at(0.95), max: s.at(-1) ?? 0};
};
const byOp = (log: readonly Timed[]) => {
	const out: Record<string, ReturnType<typeof stats>> = {};
	for (const op of new Set(log.map((l) => l.op)))
		out[op] = stats(log.filter((l) => l.op === op).map((l) => l.ms));
	return out;
};
type Sizes = readonly {kind: string; rows: number; body: number; rest: number}[];
const bytesOf = (sizes: Sizes) => ({
	full: sizes.find((s) => s.kind === "full") ?? {rows: 0, body: 0},
	patch: sizes.find((s) => s.kind === "patch") ?? {rows: 0, body: 0},
	body: sizes.reduce((a, s) => a + s.body, 0),
	rest: sizes.reduce((a, s) => a + s.rest, 0),
});

/** Read one record back whole, `times` times: how long rebuilding its steps from patches takes. */
const readTimes = (url: string, trace: string, times: number) =>
	Effect.gen(function* () {
		const traces = yield* Traces;
		const ms: number[] = [];
		let steps = 0;
		let answer = 0;
		for (let i = 0; i < times; i++) {
			const t0 = performance.now();
			const got = yield* traces.read(trace);
			ms.push(performance.now() - t0);
			steps = got.steps.length;
			answer = JSON.stringify(got).length;
		}
		return {steps, answer, ...stats(ms)};
	}).pipe(Effect.provide(Layer.fresh(layerTracesHttp({url, ledger: LEDGER, token: door}))));

const WORKLOADS = {tracker: trackerSteps(), churn: churnSteps()};
const opsOf = (log: readonly Timed[]) =>
	Object.fromEntries(
		[...new Set(log.map((l) => l.op))].map((op) => [op, log.filter((l) => l.op === op).length]),
	);
const wholeOf = (steps: Steps) => steps.map((s) => JSON.stringify(s.state).length);

const rows: unknown[] = [];
for (const keyframe of KEYFRAMES) {
	const mf = new Miniflare(
		ledgerOptions({
			persist: false,
			direct: 0,
			keyframe,
			door: {kind: "local", person: "owner", secret: door},
		}),
	);
	await mf.ready;
	const url = (await mf.unsafeGetDirectURL()).origin;
	const three = await Effect.runPromise(tallyJob(url, 3));
	const hundred = await Effect.runPromise(tallyJob(url, 100));
	const sizes = async (trace: string) =>
		bytesOf((await recordInside(mf, LEDGER, trace).sizes()) as Sizes);
	const workloads: Record<string, unknown> = {};
	for (const [name, steps] of Object.entries(WORKLOADS)) {
		const job = await Effect.runPromise(stepsJob(url, `${name}-exp166`, steps));
		const whole = wholeOf(steps);
		workloads[name] = {
			wholeState: stats(whole),
			wholeBytes: whole.reduce((a, b) => a + b, 0),
			bytes: await sizes(job.trace),
			simulated: {
				count: simulate(steps, keyframe, "count"),
				bytes: simulate(steps, keyframe, "bytes"),
			},
			time: byOp(job.log),
			read: await Effect.runPromise(readTimes(url, job.trace, 10)),
		};
	}
	const row = {
		keyframe,
		tally3: {
			writes: three.log.length,
			ops: opsOf(three.log),
			wallMs: three.wall,
			bytes: await sizes(three.trace),
			time: byOp(three.log),
		},
		tally100: {
			writes: hundred.log.length,
			ops: opsOf(hundred.log),
			wallMs: hundred.wall,
			bytes: await sizes(hundred.trace),
			time: byOp(hundred.log),
			read: await Effect.runPromise(readTimes(url, hundred.trace, 10)),
		},
		...workloads,
	};
	rows.push(row);
	console.log(JSON.stringify(row));
	await mf.dispose();
}

writeFileSync(
	new URL("./results/166-step-size.json", import.meta.url),
	`${JSON.stringify({date: new Date().toISOString().slice(0, 10), node: process.version, rows}, null, 2)}\n`,
);
