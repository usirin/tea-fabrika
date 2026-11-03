// The hosted lane's runs, read as behaviours of a TLA+ spec of it (experiment 139). The spec is
// experiments/139-tla-trace-validation/HostedLaneV2.tla, experiment 116's HostedLane.tla fixed
// where real runs showed it wrong. The trace is the ledger's own log, read after the run: one
// order for every write, its `pos`. The code logs nothing for it.
//
// Each row the spec cares about is one of its actions. k is the child's place in the order the
// lane started them:
//
//   <child> registered, its parent the lane   Start         proc[k] "up", the lane "running"
//   <child>/outcome                            WriteRow(k)   row[k] "done" or "stuck"
//   <child> exited                             End(k)        proc[k] "down"
//   EXIT from <child> in <lane>/inbox          Deliver(k)    exit[k]
//   <lane>/state leaving "running <child>"     SeeRow        seen[k]; the lane "ready", or "over"
//                                              SeeExit       the same, when the lane's report says
//                                                            `<child>: no_outcome`
//   <lane> exited                              Exit          the lane "gone"
//   <lane>/state "over", no child taken        Ended         a step the spec has no action for
//   a child past the spec's bound N            TooMany       the same
//
// Every other row (the lane's other saved states, claims, jobs, facts) leaves the spec's
// variables as they were: a stutter, left out.
//
// `driveCase` runs the same world, but each child waits to be told when to write its row and when
// to exit, so a test can push a run down one path of the spec (experiment 139's second question).

import {Ledger, type Row} from "@kampus/fabrika-old";
import {Deferred, Effect, Exit, Schema} from "effect";
import {
	type ChildPlan,
	LANE,
	LIMIT_MS,
	startLane,
	tick,
	type Variant,
	worldOf,
} from "./lane-ends.ts";

export const Proc = Schema.Literals(["none", "up", "down"]);
export type Proc = typeof Proc.Type;
export const Kind = Schema.Literals(["none", "done", "stuck"]);
export type Kind = typeof Kind.Type;

/** The spec's six variables, with each child's entry at k - 1. */
export const SpecState = Schema.Struct({
	lane: Schema.Literals(["ready", "running", "over", "gone"]),
	cur: Schema.Number,
	proc: Schema.Array(Proc),
	row: Schema.Array(Kind),
	exit: Schema.Array(Schema.Boolean),
	seen: Schema.Array(Schema.Boolean),
});
export type SpecState = typeof SpecState.Type;

export type Act =
	| "Start"
	| "WriteRow"
	| "End"
	| "Deliver"
	| "SeeRow"
	| "SeeExit"
	| "Exit"
	| "Ended"
	| "TooMany";

/** One step of a run: the action it names, for which child, the ledger row, the state after. */
export interface Step {
	readonly act: Act;
	readonly k: number;
	readonly pos: number;
	readonly to: SpecState;
}

/** The lane's own steps: the ones a driver waits for, never makes. */
export const isLaneStep = (act: Act) =>
	act === "Start" || act === "SeeRow" || act === "SeeExit" || act === "Exit" || act === "Ended";

/** The spec's `Init`, for N children. */
export const initOf = (n: number): SpecState => ({
	lane: "ready",
	cur: 1,
	proc: Array.from({length: n}, () => "none"),
	row: Array.from({length: n}, () => "none"),
	exit: Array.from({length: n}, () => false),
	seen: Array.from({length: n}, () => false),
});

const put = <A>(xs: readonly A[], k: number, x: A): readonly A[] =>
	xs.map((y, i) => (i === k - 1 ? x : y));

/** A row's data, as much of it as the mapping reads; a row that does not decode says nothing. */
const reader =
	<A>(decode: (data: string) => Exit.Exit<A, unknown>) =>
	(data: string): A | null => {
		const r = decode(data);
		return Exit.isSuccess(r) ? r.value : null;
	};

const parentOf = reader(
	Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Struct({parent: Schema.String}))),
);
const fromOf = reader(
	Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Struct({from: Schema.String}))),
);
const outcomeOf = reader(
	Schema.decodeUnknownExit(
		Schema.fromJsonString(
			Schema.Struct({outcome: Schema.Struct({outcome: Schema.Struct({kind: Schema.String})})}),
		),
	),
);
/** The lane's saved state: its phase, the child it waits on, the problems its report names. */
const savedOf = reader(
	Schema.decodeUnknownExit(
		Schema.fromJsonString(
			Schema.Struct({
				state: Schema.Struct({
					phase: Schema.String,
					child: Schema.optional(Schema.String),
					report: Schema.optional(
						Schema.Struct({problems: Schema.optional(Schema.Array(Schema.String))}),
					),
				}),
			}),
		),
	),
);

/** What a child's outcome row says: `done`, or anything else, which the lane counts as stuck. */
const kindOf = (data: string): Kind =>
	outcomeOf(data)?.outcome.outcome.kind === "done" ? "done" : "stuck";

/** One run's ledger log as the spec's steps, for a spec of N children. Pure. */
export const stepsOf = (log: readonly Row[], n: number, lane: string = LANE): readonly Step[] => {
	let s = initOf(n);
	const kids: string[] = [];
	let waitingOn: string | null = null;
	const out: Step[] = [];
	const step = (act: Act, k: number, pos: number, to: SpecState) => {
		s = to;
		out.push({act, k, pos, to});
	};
	/** A child's place, 1 first; 0: not one of the lane's children, or past the bound. */
	const placeOf = (name: string) => {
		const k = kids.indexOf(name) + 1;
		return k > n ? 0 : k;
	};
	for (const r of log) {
		if (r.kind === "registered" && parentOf(r.data)?.parent === lane) {
			kids.push(r.stream);
			const k = kids.length;
			if (k > n) step("TooMany", k, r.pos, s);
			else step("Start", k, r.pos, {...s, lane: "running", cur: k, proc: put(s.proc, k, "up")});
		} else if (
			r.kind === "outcome" &&
			r.stream.endsWith("/outcome") &&
			r.stream !== `${lane}/outcome`
		) {
			const k = placeOf(r.stream.slice(0, -"/outcome".length));
			if (k > 0) step("WriteRow", k, r.pos, {...s, row: put(s.row, k, kindOf(r.data))});
		} else if (r.kind === "exited" && r.stream === lane) {
			step("Exit", s.cur, r.pos, {...s, lane: "gone"});
		} else if (r.kind === "exited") {
			const k = placeOf(r.stream);
			if (k > 0) step("End", k, r.pos, {...s, proc: put(s.proc, k, "down")});
		} else if (r.kind === "EXIT" && r.stream === `${lane}/inbox`) {
			const k = placeOf(fromOf(r.data)?.from ?? "");
			if (k > 0) step("Deliver", k, r.pos, {...s, exit: put(s.exit, k, true)});
		} else if (r.kind === "state" && r.stream === `${lane}/state`) {
			const now = savedOf(r.data)?.state;
			if (now === undefined) continue;
			const was: string | null = waitingOn;
			waitingOn = now.phase === "running" ? (now.child ?? null) : null;
			const over = now.phase === "over";
			if (was !== null && waitingOn !== was) {
				const k = placeOf(was);
				if (k === 0) continue;
				const none = over && (now.report?.problems ?? []).includes(`${was}: no_outcome`);
				step(none ? "SeeExit" : "SeeRow", k, r.pos, {
					...s,
					seen: put(s.seen, k, true),
					lane: over ? "over" : "ready",
					cur: over ? k : k + 1,
				});
			} else if (over && s.lane !== "over") step("Ended", s.cur, r.pos, {...s, lane: "over"});
		}
	}
	return out;
};

// ---------------------------------------------------------------- driven runs

/**
 * One move a driver makes for the children: child k writes its row, or child k exits. `after`: how
 * many of the lane's own steps come before it on the path the move is taken from.
 */
export type Push =
	| {
			readonly act: "WriteRow";
			readonly k: number;
			readonly kind: "done" | "stuck";
			readonly after: number;
	  }
	| {readonly act: "End"; readonly k: number; readonly after: number};

/** A path's moves for the children, and how many steps of the lane's own it has in all. */
export interface Script {
	readonly pushes: readonly Push[];
	readonly laneSteps: number;
}

/** What a driven run did. `stalled`: the path promised a step of the lane's that never came. */
export interface Driven {
	readonly log: readonly Row[];
	readonly steps: readonly Step[];
	readonly stalled: {readonly before: number; readonly wanted: number; readonly had: number} | null;
}

/**
 * Run the lane with children that move only when the script says: each push waits until the lane
 * has made `after` steps of its own and the child is running, then lets the child write or exit,
 * with no tick of the clock in between. After the last push it waits for the rest of the path's
 * lane steps, then for the run to rest: `limitMs` of virtual time with no step.
 */
export const driveCase = (o: {
	readonly variant: Variant;
	readonly script: Script;
	/** The spec's bound, for reading the log. */
	readonly n: number;
	readonly limitMs?: number;
}): Effect.Effect<Driven> =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const limitMs = o.limitMs ?? LIMIT_MS;
		const kinds = new Map<number, "done" | "stuck">();
		for (const p of o.script.pushes) if (p.act === "WriteRow") kinds.set(p.k, p.kind);
		const named = new Set(o.script.pushes.map((p) => p.k));
		const gates = new Map<
			number,
			{write: Deferred.Deferred<void>; exit: Deferred.Deferred<void>}
		>();
		for (const k of named)
			gates.set(k, {write: yield* Deferred.make<void>(), exit: yield* Deferred.make<void>()});
		const live = new Set<number>();
		let started = 0;
		const planOf = (_name: string): ChildPlan => {
			started += 1;
			const k = started;
			live.add(k);
			const gate = gates.get(k);
			// A child the script never names waits for good: the trace shows it was started.
			if (gate === undefined)
				return {ending: "row_stuck", before: Effect.never, after: Effect.void};
			const kind = kinds.get(k);
			return {
				ending: kind === undefined ? "no_row" : kind === "done" ? "row_done" : "row_stuck",
				before: kind === undefined ? Effect.void : Deferred.await(gate.write),
				after: Deferred.await(gate.exit),
			};
		};
		yield* startLane(o.variant, planOf, () => {});

		const steps = ledger.read(0, 1_000_000).pipe(
			Effect.orDie,
			Effect.map((log) => stepsOf(log, o.n)),
		);
		const laneSteps = (s: readonly Step[]) => s.filter((x) => isLaneStep(x.act)).length;
		/** Tick until `until` holds (true), or until no step came for `limitMs` (false). */
		const waitFor = (until: (s: readonly Step[]) => boolean) =>
			Effect.gen(function* () {
				let seen = -1;
				let quiet = 0;
				for (;;) {
					const s = yield* steps;
					if (until(s)) return true;
					if (s.length !== seen) {
						seen = s.length;
						quiet = 0;
					}
					if (quiet > limitMs) return false;
					yield* tick;
					quiet += 50;
				}
			});

		let stalled: Driven["stalled"] = null;
		for (const [at, p] of o.script.pushes.entries()) {
			const ok = yield* waitFor((s) => laneSteps(s) >= p.after && live.has(p.k));
			if (!ok) {
				stalled = {before: at, wanted: p.after, had: laneSteps(yield* steps)};
				break;
			}
			const gate = gates.get(p.k);
			if (gate !== undefined)
				yield* Deferred.succeed(p.act === "WriteRow" ? gate.write : gate.exit, undefined);
			for (let y = 0; y < 50; y++) yield* Effect.yieldNow;
		}
		if (stalled === null) {
			const want = o.script.laneSteps;
			if (!(yield* waitFor((s) => laneSteps(s) >= want)))
				stalled = {before: o.script.pushes.length, wanted: want, had: laneSteps(yield* steps)};
		}
		yield* waitFor(() => false);
		const log = yield* ledger.read(0, 1_000_000).pipe(Effect.orDie);
		return {log, steps: stepsOf(log, o.n), stalled};
	}).pipe(Effect.scoped, Effect.provide(worldOf()));
