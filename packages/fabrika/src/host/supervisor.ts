// OTP's `supervisor` as a tea program a host serves under a registered name like any other. Its
// children are names it starts with `Self.startChild`: the ledger registers each one under it as
// parent and links them. It traps exits, so a child's exit comes to its inbox as an EXIT message; it
// decides there, in its reducer, what to start again. 99 had `one_for_one` only; 100 adds the rest.
//
// Restart strategies (OTP's; child order is the spec's order):
//
//   one_for_one    the child that exited is started again, alone
//   one_for_all    every other child is stopped too, then all are started again, in order
//   rest_for_one   the children after it in the spec are stopped, then it and they start again
//
// Restart types, per child:
//
//   permanent    always started again                      (OTP's default)
//   transient    started again only after a crash or a kill; a clean exit leaves it stopped
//   temporary    never started again, and dropped from the list when it ends
//
// Stopping a child is OTP's `shutdown` option: `brutal_kill` (kill at once), a number of ms (send
// `shutdown`, then kill if it has not ended by then), or `infinity` (send `shutdown`, wait; the
// default for a child that is itself a supervisor). Stops go one at a time in reverse start order;
// starts wait until nothing is stopping, then go one at a time in start order (OTP's order).
//
// Restart intensity, OTP's word for the brake: at most `intensity` restarts within `periodMs`. One
// more and the supervisor gives up: it stops every child (reverse order, each by its `shutdown`),
// then exits `shutdown`, and its own parent decides. That is escalation: one level per give-up. A
// supervisor that is a child of another is a child like any other (`type: "supervisor"`).
//
// Restart backoff (off by default, as in OTP): with `backoff`, the n-th restart in a row of one
// child waits `min(maxMs, minMs * 2^(n-1))` after its exit, the way Akka's BackoffSupervisor and
// Kubernetes' CrashLoopBackOff wait. A run that lived `resetAfterMs` or more starts the count again.
// A spec whose backoff spreads `intensity` restarts past `periodMs` is refused: its brake could
// never trip, and a crash loop would never reach the parent.
//
// Calls, OTP's `supervisor` API: `start_child`, `terminate_child`, `restart_child`,
// `delete_child`, `which_children`. Each is a message `{id, replyTo, req}`; the reply goes to
// `replyTo` once the work is done (a started child, a stopped one), under the message id
// `reply:<id>`. A call sent again under the same id gets the same reply and does the work once.
// 99's cast `{start_child: spec}` still works, with no reply.
//
// Time comes in as data (the EXIT's `at`, the ledger's clock; a start's or a signal's `at`), so a
// replay decides the same way. A host takeover changes nothing: the state replays, and the Subs
// send again what is still in flight; every send is idempotent (`after`, the incarnation, the id).
//
// The machine is pure and exported (`createSupervisor`, `superviseWith`): the laws in
// `@kampus/pipeline`'s src/laws/ walk it. `supervisor(spec)` refuses a spec that cannot work,
// rather than warn.
//
// New in 102: limits. A child spec may carry `limits` (a pod spec's `resources.limits`); the ledger
// keeps and enforces them, not the supervisor. What the supervisor does about them:
//
//   a child's run ended `limit:<kind>`    never started again, never counted toward intensity
//                                         (Kubernetes does not restart a Job past its deadline);
//                                         it stays stopped, spec kept, for `restart_child` after a
//                                         raise. A temporary child is dropped, as on any exit.
//   a start refused, `children`           a new `start_child` is answered `max_children` and
//                                         dropped (OTP's `{error, max_children}`); a spec child or
//                                         a restart is tried again `LIMIT_RETRY_MS` later
//   a start refused, any other limit      the tree is spent, or the child's last run was ended by
//                                         a limit: a new child is answered `limit:<kind>` and
//                                         dropped; a restart is left stopped
import {type DepKeyedSub, defineMachine, type Sub} from "@demlik/tea";
import {Duration, Effect, Exit, Schedule, Schema, Stream} from "effect";
import {defineProgram} from "../program/program.ts";
import {input} from "../program/shape.ts";
import {type Envelope, envelope, Self, type Starting} from "./host.ts";
import {EndReason, ExitMessage, inboxOf, LimitsSchema, type Over} from "./ledger.ts";
import {isLimitReason, limitsRefusal, MAX_DELIVERIES, type Signal} from "./rules.ts";

// ---------------------------------------------------------------- the spec

export const Restart = Schema.Literals(["permanent", "transient", "temporary"]);
export type Restart = typeof Restart.Type;
/** OTP's `shutdown`: kill at once, wait this many ms after `shutdown` and then kill, or wait. */
export const Shutdown = Schema.Union([Schema.Literals(["brutal_kill", "infinity"]), Schema.Number]);
export type Shutdown = typeof Shutdown.Type;
export const ChildType = Schema.Literals(["worker", "supervisor"]);
export type ChildType = typeof ChildType.Type;

export const ChildSpec = Schema.Struct({
	name: Schema.String,
	restart: Restart,
	/** Default 5000 for a worker, `infinity` for a supervisor (OTP's defaults). */
	shutdown: Schema.optional(Shutdown),
	type: Schema.optional(ChildType),
	/** 102: the child's limits, from its first start on. The ledger enforces them. */
	limits: Schema.optional(LimitsSchema),
});
export type ChildSpec = typeof ChildSpec.Type;

/** 102: the wait before a start refused for `children` is tried again (a ReplicaSet's retry). */
export const LIMIT_RETRY_MS = 1000;

export type Strategy = "one_for_one" | "one_for_all" | "rest_for_one";

export interface Backoff {
	/** The wait before the first restart in a row. */
	readonly minMs: number;
	/** The longest wait. */
	readonly maxMs: number;
	/** A run that lived this long ends the row: the next restart waits `minMs` again. */
	readonly resetAfterMs: number;
}

export interface SupervisorSpec {
	/** OTP's restart strategy. */
	readonly strategy: Strategy;
	/** OTP's `intensity`: restarts allowed within `periodMs`. One more and the supervisor gives up. */
	readonly intensity: number;
	/** OTP's `period`, in milliseconds. */
	readonly periodMs: number;
	readonly children: readonly ChildSpec[];
	/** Restart backoff; none by default (OTP has none). */
	readonly backoff?: Backoff;
	/**
	 * How many times in a row the ledger lets one message crash a program before it sets it aside
	 * (its `maxDeliveries`; `null`: never). Default `MAX_DELIVERIES`. The spec is refused when
	 * `intensity` is below it: one poison message would bring the whole tree down.
	 */
	readonly maxDeliveries?: number | null;
}

/** The wait before the `n`-th restart in a row (n from 1). */
export const delayOf = (b: Backoff | undefined, n: number): number =>
	b === undefined || n < 1 ? 0 : Math.min(b.maxMs, b.minMs * 2 ** (n - 1));

const STRATEGIES: readonly Strategy[] = ["one_for_one", "one_for_all", "rest_for_one"];

/** Why a spec is refused, or null: it can work. */
export const refusalOf = (name: string, spec: SupervisorSpec): string | null => {
	if (!STRATEGIES.includes(spec.strategy)) return `no strategy ${spec.strategy}`;
	if (!Number.isInteger(spec.intensity) || spec.intensity < 0)
		return "intensity must be a whole number, 0 or more";
	if (!(spec.periodMs > 0)) return "periodMs must be more than 0";
	const names = spec.children.map((c) => c.name);
	if (new Set(names).size !== names.length) return "two children share a name";
	if (names.includes(name)) return "a child cannot be the supervisor's own name";
	for (const c of spec.children) {
		if (typeof c.shutdown === "number" && !(c.shutdown >= 0 && Number.isFinite(c.shutdown)))
			return `child ${c.name}: shutdown must be 0 ms or more, brutal_kill or infinity`;
		const bad = c.limits === undefined ? null : limitsRefusal(c.limits);
		if (bad !== null) return `child ${c.name}: ${bad}`;
	}
	const deliveries = spec.maxDeliveries === undefined ? MAX_DELIVERIES : spec.maxDeliveries;
	if (deliveries !== null && spec.intensity < deliveries)
		return `intensity ${spec.intensity} is below maxDeliveries ${deliveries}: one poison message would take the whole tree down before the ledger sets it aside`;
	const b = spec.backoff;
	if (b !== undefined) {
		if (!(b.minMs > 0) || !(b.maxMs >= b.minMs) || !(b.resetAfterMs >= 0))
			return "backoff needs 0 < minMs <= maxMs and resetAfterMs >= 0";
		let spread = 0;
		for (let n = 1; n <= spec.intensity; n++) spread += delayOf(b, n);
		if (spread >= spec.periodMs)
			return `backoff spreads ${spec.intensity} restarts over ${spread} ms, not under periodMs ${spec.periodMs}: the brake could never trip, so a crash loop would never reach the parent`;
	}
	return null;
};

// ---------------------------------------------------------------- the state

const Ended = Schema.Struct({
	incarnation: Schema.Number,
	reason: EndReason,
	why: Schema.String,
	/** When the ledger wrote the exit, by the ledger's clock. */
	at: Schema.Number,
});
export type Ended = typeof Ended.Type;

/** What to do once a child being stopped has ended. */
const AfterStop = Schema.Union([
	Schema.Struct({do: Schema.Literal("restart"), notBefore: Schema.Number}),
	/** `stay`: stopped, spec kept (terminate_child); `remove`: gone (temporary, or giving up). */
	Schema.Struct({do: Schema.Literals(["stay", "remove"])}),
]);
export type AfterStop = typeof AfterStop.Type;

/** One child's run, as the supervisor knows it. Each case carries only what it needs. */
export const Run = Schema.Union([
	/** Up at the child's `incarnation`, since `since` (the start's answer). */
	Schema.Struct({is: Schema.Literal("up"), since: Schema.Number}),
	/**
	 * To be started, not before `notBefore`: the restart of the run `after` (null: start it if it is
	 * not up). `held`: an exit that came before the start answered, decided once it does.
	 * `generation`: one more each time a group restart catches it here, as Kafka's consumer group
	 * generation goes up at each rebalance; a start sent in an earlier generation may land before
	 * the sibling it must follow, so its run is stopped and started again.
	 */
	Schema.Struct({
		is: Schema.Literal("starting"),
		after: Schema.NullOr(Schema.Number),
		notBefore: Schema.Number,
		held: Schema.NullOr(Ended),
		generation: Schema.Number,
	}),
	/** Being stopped. `signalledAt`: when the first signal landed (null: none yet). */
	Schema.Struct({
		is: Schema.Literal("stopping"),
		afterStop: AfterStop,
		signalledAt: Schema.NullOr(Schema.Number),
	}),
	/** Not running, spec kept: terminate_child, or a transient child that ended cleanly. */
	Schema.Struct({is: Schema.Literal("stopped")}),
]);
export type Run = typeof Run.Type;

export const Child = Schema.Struct({
	name: Schema.String,
	restart: Restart,
	shutdown: Shutdown,
	type: ChildType,
	/** The child's incarnation as last known: 0 before its first start. */
	incarnation: Schema.Number,
	/** Restarts in a row, for the backoff. */
	fails: Schema.Number,
	run: Run,
	/** 102: its limits, sent with its first start. */
	limits: Schema.optional(LimitsSchema),
});
export type Child = typeof Child.Type;

/** One child as `which_children` lists it. */
export const ChildInfo = Schema.Struct({
	name: Schema.String,
	incarnation: Schema.Number,
	run: Schema.Literals(["up", "starting", "stopping", "stopped"]),
	restart: Restart,
	type: ChildType,
});
export type ChildInfo = typeof ChildInfo.Type;
/** What a call answers: OTP's `{ok, ...}` or `{error, Why}`. */
export const Answer = Schema.Union([
	Schema.Struct({ok: Schema.Literal(true), incarnation: Schema.Number}),
	Schema.Struct({ok: Schema.Literal(true), children: Schema.Array(ChildInfo)}),
	Schema.Struct({ok: Schema.Literal(true)}),
	Schema.Struct({ok: Schema.Literal(false), error: Schema.String}),
]);
export type Answer = typeof Answer.Type;
/** The body of a reply in the caller's inbox. */
export const Reply = Schema.Struct({id: Schema.String, res: Answer});
export type Reply = typeof Reply.Type;

const Caller = Schema.Struct({id: Schema.String, replyTo: Schema.String});
export type Caller = typeof Caller.Type;
const Outgoing = Schema.Struct({id: Schema.String, replyTo: Schema.String, res: Answer});
export type Outgoing = typeof Outgoing.Type;
const Waiting = Schema.Struct({
	id: Schema.String,
	replyTo: Schema.String,
	name: Schema.String,
	until: Schema.Literals(["started", "stopped"]),
});

/** How many answered call ids the supervisor keeps, to answer a resent call the same way. */
export const MEMO = 64;

export const SupervisorState = Schema.Struct({
	/** The inbox rev of the last message read. */
	cursor: Schema.Number,
	/** The supervisor's own incarnation this state belongs to: a new one starts from the spec. */
	incarnation: Schema.Number,
	/** Its own parent, if any: an EXIT from it shuts the supervisor down (OTP). */
	parent: Schema.NullOr(Schema.String),
	/** In start order: the spec's, then each `start_child` at the end. */
	children: Schema.Array(Child),
	/** The `at` of each restart still inside the period: OTP's restart list. */
	restarts: Schema.Array(Schema.Number),
	/** Restarts in all, this incarnation. */
	restarted: Schema.Number,
	/** `stopping`: it gave up (or its parent said shutdown) and stops its children; then it exits. */
	phase: Schema.Literals(["running", "stopping", "shutdown"]),
	/** Why it is stopping, or null. */
	why: Schema.NullOr(Schema.String),
	/** Calls waiting on a child's start or stop. */
	waiting: Schema.Array(Waiting),
	/** Replies to send. */
	outbox: Schema.Array(Outgoing),
	/** The last `MEMO` answers, by call id. */
	answered: Schema.Array(Schema.Struct({id: Schema.String, res: Answer})),
});
export type SupervisorState = typeof SupervisorState.Type;

export const NOT_BEGUN: SupervisorState = {
	cursor: 0,
	incarnation: 0,
	parent: null,
	children: [],
	restarts: [],
	restarted: 0,
	phase: "running",
	why: null,
	waiting: [],
	outbox: [],
	answered: [],
};

// ---------------------------------------------------------------- the messages

export type Request =
	| {readonly op: "start_child"; readonly spec: ChildSpec}
	| {readonly op: "terminate_child" | "restart_child" | "delete_child"; readonly name: string}
	| {readonly op: "which_children"};

export type SupervisorMsg =
	/** The program started: under which incarnation of itself, and who its parent is. */
	| {readonly type: "begin"; readonly incarnation: number; readonly parent: string | null}
	/** An EXIT from a linked name (or its parent's shutdown), at inbox rev `rev`, for run `to`. */
	| ({
			readonly type: "exit";
			readonly rev: number;
			readonly from: string;
			readonly to: number;
	  } & Ended)
	/** A call (or 99's start_child cast: no caller), at inbox rev `rev`. */
	| {
			readonly type: "request";
			readonly rev: number;
			readonly caller: Caller | null;
			readonly req: Request;
	  }
	/**
	 * A start answered at `at`: the child is up at `incarnation` (or down there, its EXIT on the
	 * way). `generation`: the generation of the start that was sent.
	 */
	| {
			readonly type: "started";
			readonly name: string;
			readonly incarnation: number;
			readonly at: number;
			readonly generation: number;
	  }
	/**
	 * A start refused: another name is the child's parent, or it is no name a register may take
	 * (`denied`); or, 102, a limit said no at `at` (`over` names it).
	 */
	| {readonly type: "start_refused"; readonly name: string; readonly why: "denied"}
	| {
			readonly type: "start_refused";
			readonly name: string;
			readonly why: "limit";
			readonly over: Over;
			readonly at: number;
	  }
	/** A stop signal answered at `at`. `noproc`: that run had ended already. */
	| {
			readonly type: "signalled";
			readonly name: string;
			readonly incarnation: number;
			readonly signal: Signal;
			readonly how: "signalled" | "exited" | "noproc";
			readonly at: number;
	  }
	/** A reply landed in its caller's inbox. */
	| {readonly type: "replied"; readonly id: string}
	/** Any other inbox message: read, and nothing else. */
	| {readonly type: "ignored"; readonly rev: number};

/** One start the `starts` Sub sends: the child, the run it replaces, and when. */
export type Start = {
	readonly name: string;
	readonly after: number | null;
	readonly notBefore: number;
	readonly generation: number;
	/** 102: the child's limits; the ledger keeps them from its first start. */
	readonly limits?: ChildSpec["limits"];
};
/** The one stop the `stops` Sub sends: which signal to which run, at `at` (0: now). */
export type Stop = {
	readonly name: string;
	readonly incarnation: number;
	readonly signal: Signal;
	readonly at: number;
};
export type SupervisorSub =
	| Sub<"starts", {readonly list: readonly Start[]}>
	| Sub<"stops", Stop>
	| Sub<"replies", {readonly list: readonly Outgoing[]}>
	| Sub<"give_up", {readonly why: string}>;

// ---------------------------------------------------------------- the reducer

type S = SupervisorState;

const childOf = (c: ChildSpec): Child => {
	const type = c.type ?? "worker";
	return {
		name: c.name,
		restart: c.restart,
		shutdown: c.shutdown ?? (type === "supervisor" ? "infinity" : 5000),
		type,
		incarnation: 0,
		fails: 0,
		run: {is: "starting", after: null, notBefore: 0, held: null, generation: 0},
		...(c.limits === undefined ? {} : {limits: c.limits}),
	};
};

const put = (s: S, c: Child): S => ({
	...s,
	children: s.children.map((x) => (x.name === c.name ? c : x)),
});
const drop = (s: S, name: string): S => ({
	...s,
	children: s.children.filter((x) => x.name !== name),
});

/** Queue one reply, and remember it under its call id. */
const answer = (s: S, to: Caller, res: Answer): S => ({
	...s,
	outbox: [...s.outbox, {id: to.id, replyTo: to.replyTo, res}],
	answered: [...s.answered, {id: to.id, res}].slice(-MEMO),
});
const answerAll = (s: S, res: Answer): S =>
	s.waiting.reduce<S>((acc, w) => answer(acc, w, res), {...s, waiting: []});

/** Answer every call waiting on `name` for `until`. */
const resolve = (s: S, name: string, until: "started" | "stopped", res: Answer): S => {
	const hit = s.waiting.filter((w) => w.name === name && w.until === until);
	if (hit.length === 0) return s;
	const rest = {...s, waiting: s.waiting.filter((w) => !hit.includes(w))};
	return hit.reduce<S>((acc, w) => answer(acc, w, res), rest);
};

const startAgain = (c: Child, notBefore: number): Run => ({
	is: "starting",
	after: c.incarnation === 0 ? null : c.incarnation,
	notBefore,
	held: null,
	generation: 0,
});

/** A child being stopped has ended (or was gone already): do what its stop was for. */
const ended = (s: S, c: Child, afterStop: AfterStop): S => {
	const done =
		afterStop.do === "restart"
			? put(s, {...c, run: startAgain(c, afterStop.notBefore)})
			: afterStop.do === "stay"
				? put(s, {...c, run: {is: "stopped"}})
				: drop(s, c.name);
	// A terminate_child waiting on it is answered even when a group restart caught the child
	// mid-stop and starts it again: it did stop.
	return resolve(done, c.name, "stopped", {ok: true});
};

/** Stop everything and exit: OTP's give-up, and its answer to its parent's `shutdown`. */
const giveUp = (s: S, why: string): S => {
	if (s.phase !== "running") return s;
	// Up: stopped, then gone. Stopping: gone once stopped. Starting: dropped (a run a late start
	// made ends with the supervisor's own exit, through their link). Stopped: kept as it is.
	const children = s.children.flatMap((c): Child[] =>
		c.run.is === "up"
			? [{...c, run: {is: "stopping", afterStop: {do: "remove"}, signalledAt: null}}]
			: c.run.is === "stopping"
				? [{...c, run: {...c.run, afterStop: {do: "remove"}}}]
				: c.run.is === "starting"
					? []
					: [c],
	);
	return {...answerAll(s, {ok: false, error: "shutting_down"}), phase: "stopping", why, children};
};

/** One sibling caught in a one_for_all or rest_for_one restart: stop it, then start it again. */
const caught = (s: S, c: Child, notBefore: number): S => {
	const remove = c.restart === "temporary";
	switch (c.run.is) {
		case "up":
			return put(s, {
				...c,
				run: {
					is: "stopping",
					afterStop: remove ? {do: "remove"} : {do: "restart", notBefore},
					signalledAt: null,
				},
			});
		case "stopping":
			return put(s, {
				...c,
				run: {
					...c.run,
					afterStop:
						remove || c.run.afterStop.do === "remove" ? {do: "remove"} : {do: "restart", notBefore},
				},
			});
		case "starting":
			// Its start may be in flight already: a new generation, so that answer is not taken as this one.
			return put(s, {
				...c,
				run: {
					...c.run,
					notBefore: Math.max(c.run.notBefore, notBefore),
					generation: c.run.generation + 1,
				},
			});
		case "stopped":
			// OTP starts a terminated sibling again in a group restart, too.
			return put(s, {...c, run: startAgain(c, notBefore)});
	}
};

/** OTP's `restart_child` after an exit nobody asked for: start it (and its group), or give up. */
const decide =
	(spec: SupervisorSpec) =>
	(s: S, c: Child, e: Ended): S => {
		const since = c.run.is === "up" ? c.run.since : e.at;
		const known = {...c, incarnation: Math.max(c.incarnation, e.incarnation)};
		if (c.restart === "temporary") return drop(s, c.name);
		// 102: its limit ended it. Starting it again would only spend past the limit again.
		if (isLimitReason(e.reason)) return put(s, {...known, run: {is: "stopped"}});
		if (c.restart === "transient" && (e.reason === "normal" || e.reason === "shutdown"))
			return put(s, {...known, run: {is: "stopped"}});
		const restarts = [...s.restarts.filter((t) => t > e.at - spec.periodMs), e.at];
		if (restarts.length > spec.intensity)
			return giveUp(
				// The child that tipped it is down already: nothing to stop.
				put({...s, restarts}, {...known, run: {is: "stopped"}}),
				`reached_max_restart_intensity: ${restarts.length} restarts within ${spec.periodMs} ms, the last for ${c.name} (${e.reason}: ${e.why})`,
			);
		const b = spec.backoff;
		const fails = b === undefined ? 0 : (e.at - since >= b.resetAfterMs ? 0 : c.fails) + 1;
		const notBefore = e.at + delayOf(b, fails);
		const me = {...known, fails, run: startAgain(known, notBefore)};
		const next = put({...s, restarts, restarted: s.restarted + 1}, me);
		const at = s.children.findIndex((x) => x.name === c.name);
		const group =
			spec.strategy === "one_for_all"
				? s.children.filter((x) => x.name !== c.name)
				: spec.strategy === "rest_for_one"
					? s.children.slice(at + 1)
					: [];
		return group.reduce((acc, x) => {
			const now = acc.children.find((y) => y.name === x.name);
			return now === undefined ? acc : caught(acc, now, notBefore);
		}, next);
	};

const infoOf = (c: Child): ChildInfo => ({
	name: c.name,
	incarnation: c.incarnation,
	run: c.run.is,
	restart: c.restart,
	type: c.type,
});

/** One call (or cast), in a running supervisor. */
const request = (name: string, s: S, caller: Caller | null, req: Request): S => {
	const reply = (st: S, res: Answer) => (caller === null ? st : answer(st, caller, res));
	const wait = (st: S, child: string, until: "started" | "stopped") =>
		caller === null ? st : {...st, waiting: [...st.waiting, {...caller, name: child, until}]};
	if (req.op === "which_children") return reply(s, {ok: true, children: s.children.map(infoOf)});
	const target = req.op === "start_child" ? req.spec.name : req.name;
	const c = s.children.find((x) => x.name === target);
	switch (req.op) {
		case "start_child": {
			if (target === name)
				return reply(s, {ok: false, error: "bad_spec: the supervisor's own name"});
			if (c !== undefined)
				return reply(s, {
					ok: false,
					error: c.run.is === "stopped" ? "already_present" : "already_started",
				});
			return wait({...s, children: [...s.children, childOf(req.spec)]}, target, "started");
		}
		case "terminate_child": {
			if (c === undefined) return reply(s, {ok: false, error: "not_found"});
			switch (c.run.is) {
				case "up":
					return wait(
						put(s, {...c, run: {is: "stopping", afterStop: {do: "stay"}, signalledAt: null}}),
						target,
						"stopped",
					);
				case "stopping": {
					const afterStop: AfterStop =
						c.run.afterStop.do === "remove" ? c.run.afterStop : {do: "stay"};
					return wait(put(s, {...c, run: {...c.run, afterStop}}), target, "stopped");
				}
				case "starting":
					// A start in flight may still land: its `started` then stops the run it made.
					return reply(put(s, {...c, run: {is: "stopped"}}), {ok: true});
				case "stopped":
					return reply(s, {ok: true});
			}
			return s;
		}
		case "restart_child": {
			if (c === undefined) return reply(s, {ok: false, error: "not_found"});
			if (c.run.is !== "stopped") return reply(s, {ok: false, error: "running"});
			return wait(put(s, {...c, fails: 0, run: startAgain(c, 0)}), target, "started");
		}
		case "delete_child": {
			if (c === undefined) return reply(s, {ok: false, error: "not_found"});
			if (c.run.is !== "stopped") return reply(s, {ok: false, error: "running"});
			return reply(drop(s, target), {ok: true});
		}
	}
};

/** Done stopping: nothing left up, starting or stopping. */
const settle = (s: S): S =>
	s.phase === "stopping" && s.children.every((c) => c.run.is === "stopped")
		? {...s, phase: "shutdown"}
		: s;

/** The supervisor's reducer: pure, and the same on every replay. */
export const superviseWith = (name: string, spec: SupervisorSpec) => {
	const restart = decide(spec);
	const step = (s: S, m: SupervisorMsg): S => {
		switch (m.type) {
			case "begin": {
				if (m.incarnation === s.incarnation) return s;
				// A new incarnation: OTP's `init/1`, every child from the spec. The cursor stays: the
				// inbox before it was read by an earlier incarnation. Calls waiting on the old one fail.
				const told = answerAll(s, {ok: false, error: "restarted"});
				return {
					...NOT_BEGUN,
					cursor: s.cursor,
					outbox: told.outbox,
					answered: told.answered,
					incarnation: m.incarnation,
					parent: m.parent,
					children: spec.children.map(childOf),
				};
			}
			case "exit": {
				if (m.rev <= s.cursor) return s;
				const read = {...s, cursor: m.rev};
				// Meant for an earlier run of this supervisor, or it is done.
				if (m.to !== s.incarnation || s.phase === "shutdown") return read;
				if (m.from === s.parent && m.from !== name)
					return giveUp(read, `parent ${m.from} exited (${m.reason})`);
				const c = read.children.find((x) => x.name === m.from);
				if (c === undefined) return read;
				const e: Ended = {incarnation: m.incarnation, reason: m.reason, why: m.why, at: m.at};
				switch (c.run.is) {
					case "starting": {
						const after = c.run.after;
						if (e.incarnation < c.incarnation || (after !== null && e.incarnation <= after))
							return read;
						const held = c.run.held;
						const keep = held !== null && held.incarnation >= e.incarnation ? held : e;
						return put(read, {...c, run: {...c.run, held: keep}});
					}
					case "up":
						return e.incarnation < c.incarnation ? read : restart(read, c, e);
					case "stopping":
						return e.incarnation < c.incarnation
							? read
							: ended(read, {...c, incarnation: e.incarnation}, c.run.afterStop);
					case "stopped":
						return put(read, {...c, incarnation: Math.max(c.incarnation, e.incarnation)});
				}
				return read;
			}
			case "request": {
				if (m.rev <= s.cursor) return s;
				const read = {...s, cursor: m.rev};
				const caller = m.caller;
				if (caller !== null) {
					const old = read.answered.find((a) => a.id === caller.id);
					if (old !== undefined)
						return read.outbox.some((o) => o.id === caller.id)
							? read
							: {...read, outbox: [...read.outbox, {...caller, res: old.res}]};
					if (read.waiting.some((w) => w.id === caller.id)) return read;
				}
				if (read.phase !== "running")
					return caller === null ? read : answer(read, caller, {ok: false, error: "shutting_down"});
				return request(name, read, caller, m.req);
			}
			case "started": {
				const c = s.children.find((x) => x.name === m.name);
				if (c === undefined || s.phase !== "running") return s;
				const incarnation = Math.max(c.incarnation, m.incarnation);
				if (c.run.is === "stopped")
					// terminate_child came while this start was in flight: stop the run it made.
					return m.incarnation >= c.incarnation
						? put(s, {
								...c,
								incarnation,
								run: {is: "stopping", afterStop: {do: "stay"}, signalledAt: null},
							})
						: s;
				if (c.run.is !== "starting") return s;
				if (m.generation < c.run.generation) {
					// Sent before a group restart caught it: it may run ahead of a sibling it must
					// follow. Stop that run (or, ended already, just start again) in the new generation. A
					// temporary child is not started again: stopped and dropped, as a group restart
					// drops it.
					const temporary = c.restart === "temporary";
					const held = c.run.held;
					if (held !== null && held.incarnation >= m.incarnation) {
						if (temporary) return drop(s, c.name);
						// 102: its limit ended it, so it is not started again.
						if (isLimitReason(held.reason))
							return resolve(put(s, {...c, incarnation, run: {is: "stopped"}}), c.name, "started", {
								ok: false,
								error: held.reason,
							});
						return put(s, {...c, incarnation, run: {...c.run, after: incarnation, held: null}});
					}
					return put(s, {
						...c,
						incarnation,
						run: {
							is: "stopping",
							afterStop: temporary ? {do: "remove"} : {do: "restart", notBefore: c.run.notBefore},
							signalledAt: null,
						},
					});
				}
				const up: Child = {...c, incarnation, run: {is: "up", since: m.at}};
				const told = resolve(put(s, up), c.name, "started", {ok: true, incarnation});
				const held = c.run.held;
				return held !== null && held.incarnation >= m.incarnation ? restart(told, up, held) : told;
			}
			case "start_refused": {
				const c = s.children.find((x) => x.name === m.name);
				if (c === undefined || c.run.is !== "starting") return s;
				if (m.why === "denied")
					return resolve(drop(s, c.name), c.name, "started", {ok: false, error: "denied"});
				// 102: a limit. A child from the spec, or one that has run, is kept.
				const fresh = c.incarnation === 0 && !spec.children.some((x) => x.name === c.name);
				const error = m.over.kind === "children" ? "max_children" : `limit:${m.over.kind}`;
				if (fresh) return resolve(drop(s, c.name), c.name, "started", {ok: false, error});
				if (m.over.kind === "children")
					return put(s, {...c, run: {...c.run, notBefore: m.at + LIMIT_RETRY_MS}});
				return resolve(put(s, {...c, run: {is: "stopped"}}), c.name, "started", {
					ok: false,
					error,
				});
			}
			case "signalled": {
				const c = s.children.find((x) => x.name === m.name);
				if (c === undefined || c.run.is !== "stopping" || m.incarnation !== c.incarnation) return s;
				if (m.how === "noproc") return ended(s, c, c.run.afterStop);
				if (c.run.signalledAt !== null) return s;
				return put(s, {...c, run: {...c.run, signalledAt: m.at}});
			}
			case "replied":
				return {...s, outbox: s.outbox.filter((o) => o.id !== m.id)};
			case "ignored":
				return m.rev <= s.cursor ? s : {...s, cursor: m.rev};
		}
	};
	return (s: S, m: SupervisorMsg): S => settle(step(s, m));
};

/** The starts to send, in start order: none while a child is still being stopped. */
export const startsOf = (s: S): readonly Start[] =>
	s.phase !== "running" || s.children.some((c) => c.run.is === "stopping")
		? []
		: s.children.flatMap((c) =>
				c.run.is === "starting"
					? [
							{
								name: c.name,
								after: c.run.after,
								notBefore: c.run.notBefore,
								generation: c.run.generation,
								...(c.limits === undefined ? {} : {limits: c.limits}),
							},
						]
					: [],
			);

/** The one stop to send now: the last child in start order being stopped, by its `shutdown`. */
export const stopOf = (s: S): Stop | null => {
	const c = s.children.findLast((x) => x.run.is === "stopping");
	if (c === undefined || c.run.is !== "stopping") return null;
	const at = c.run.signalledAt;
	const of = {name: c.name, incarnation: c.incarnation};
	if (c.shutdown === "brutal_kill") return at === null ? {...of, signal: "kill", at: 0} : null;
	if (at === null) return {...of, signal: "shutdown", at: 0};
	if (c.shutdown === "infinity") return null;
	return {...of, signal: "kill", at: at + c.shutdown};
};

/**
 * The supervisor machine. `begin`: the run it starts under (Elm's flags). It is applied in `init`,
 * before any Sub runs: a state saved by an earlier run (one that gave up, say) must never act again.
 */
export const createSupervisor = (
	name: string,
	spec: SupervisorSpec,
	begin?: {readonly incarnation: number; readonly parent: string | null},
) => {
	const step = superviseWith(name, spec);
	const update = (s: S, m: SupervisorMsg): [S, never[]] => [step(s, m), []];
	const first = (loaded: S | null | undefined): S => {
		const s = loaded ?? NOT_BEGUN;
		return begin === undefined ? s : step(s, {type: "begin", ...begin});
	};
	return defineMachine<S, SupervisorMsg, never, SupervisorSub, undefined>({
		types: {
			model: {} as S,
			msg: {} as SupervisorMsg,
			cmd: {} as never,
			sub: {} as SupervisorSub,
			ctx: undefined,
		},
		init: (loaded) => [first(loaded), []],
		update: {
			begin: update,
			exit: update,
			request: update,
			started: update,
			start_refused: update,
			signalled: update,
			replied: update,
			ignored: update,
		},
		subs: [
			// The casts: tea's `DepKeyedSub` is a conditional type a literal cannot be checked against.
			{
				type: "starts",
				deps: (s: S) => {
					const list = startsOf(s);
					return list.length === 0 ? null : {list};
				},
			} as DepKeyedSub<S, SupervisorSub>,
			{type: "stops", deps: (s: S) => stopOf(s)} as DepKeyedSub<S, SupervisorSub>,
			{
				type: "replies",
				deps: (s: S) => (s.outbox.length === 0 ? null : {list: s.outbox}),
			} as DepKeyedSub<S, SupervisorSub>,
			{
				type: "give_up",
				deps: (s: S) => (s.phase === "shutdown" ? {why: s.why ?? "shutdown"} : null),
			} as DepKeyedSub<S, SupervisorSub>,
		],
	});
};

// ---------------------------------------------------------------- the inbox

/** The body of 99's `start_child` cast. */
export const StartChild = Schema.Struct({start_child: ChildSpec});
/** What a call asks, on the wire. */
export const RequestBody = Schema.Union([
	Schema.Struct({op: Schema.Literal("start_child"), spec: ChildSpec}),
	Schema.Struct({
		op: Schema.Literals(["terminate_child", "restart_child", "delete_child"]),
		name: Schema.String,
	}),
	Schema.Struct({op: Schema.Literal("which_children")}),
]);
/** The body of a call: `id` is the idempotency key and the reply's correlation id. */
export const CallBody = Schema.Struct({
	id: Schema.String,
	replyTo: Schema.String,
	req: RequestBody,
});
export type CallBody = typeof CallBody.Type;

const decodeExit = Schema.decodeUnknownExit(ExitMessage);
const decodeStart = Schema.decodeUnknownExit(StartChild);
const decodeCall = Schema.decodeUnknownExit(CallBody);

/** One inbox envelope as the supervisor reads it. Only the ledger writes an `EXIT`. */
export const msgOf = (e: Envelope<unknown>): SupervisorMsg => {
	if (e.kind === "EXIT" && e.from === "ledger") {
		const x = decodeExit(e.body);
		if (Exit.isSuccess(x)) return {type: "exit", rev: e.rev, ...x.value};
	}
	if (e.kind === "cast" || e.kind === "message") {
		const c = decodeCall(e.body);
		if (Exit.isSuccess(c)) {
			const {id, replyTo, req} = c.value;
			return {type: "request", rev: e.rev, caller: {id, replyTo}, req};
		}
		const x = decodeStart(e.body);
		if (Exit.isSuccess(x))
			return {
				type: "request",
				rev: e.rev,
				caller: null,
				req: {op: "start_child", spec: x.value.start_child},
			};
	}
	return {type: "ignored", rev: e.rev};
};

// ---------------------------------------------------------------- the program

/** A lease word for `main` to die with: the host reads it as a lost lease, not a crash. */
const fencedOut = (what: string) => Effect.die({_tag: "Fenced", what});
const sleepUntil = (at: number) => Effect.sleep(Duration.millis(Math.max(0, at - Date.now())));
/** The wait before a ledger call that did not answer is sent again. */
const AGAIN_MS = 100;

export type Supervisor =
	| {readonly ok: true; readonly program: ReturnType<typeof supervisorProgram>}
	| {readonly ok: false; readonly why: string};

const supervisorProgram = (name: string, spec: SupervisorSpec) =>
	defineProgram({
		name: "supervisor",
		description: `OTP's ${spec.strategy} supervisor: starts its children, stops and starts them again by its strategy, and gives up past its restart intensity.`,
		inputs: {
			inbox: input(envelope(Schema.Unknown), "An EXIT from a child or the parent, or a call."),
		},
		outputs: {},
		main: ({inputs}) =>
			Effect.gen(function* () {
				const self = yield* Self;
				if (self.name !== name)
					return yield* Effect.die(`supervisor for ${name} served under ${self.name}`);
				// 151: at the start too, a ledger that does not answer is asked again until it does. Its
				// fence holds until someone newer claims, so waiting loses nothing; the host's lease
				// clock ends the run past its grace. (Both gave up after a second, and the host
				// started the run again.)
				const again = Schedule.spaced(Duration.millis(AGAIN_MS));
				// Exits first: a child's exit must come as a message, never take this name down.
				const trapped = yield* self
					.trapExit(true)
					.pipe(Effect.repeat({until: (w) => w !== "unreachable", schedule: again}));
				if (trapped !== "ok") return yield* fencedOut("trap_exit");
				const info = yield* self.reads.processInfo(name).pipe(Effect.retry(again), Effect.orDie);
				const startOne = (s: Start) =>
					Effect.gen(function* () {
						yield* sleepUntil(s.notBefore);
						for (;;) {
							const r: Starting = yield* self.startChild(s.name, s.after, s.limits);
							if (r.how === "ok") {
								const at = Date.now();
								return {
									type: "started",
									name: s.name,
									incarnation: r.incarnation,
									at,
									generation: s.generation,
								} as const;
							}
							if (r.how === "denied")
								return {type: "start_refused", name: s.name, why: "denied"} as const;
							if (r.how === "limit")
								return {
									type: "start_refused",
									name: s.name,
									why: "limit",
									over: r.over,
									at: Date.now(),
								} as const;
							if (r.how === "fenced") return null;
							yield* Effect.sleep(Duration.millis(AGAIN_MS));
						}
					});
				const stopOne = (s: Stop) =>
					Effect.gen(function* () {
						yield* sleepUntil(s.at);
						for (;;) {
							const why = `${name}: ${s.signal}`;
							const how = yield* self.exitChild(s.name, s.incarnation, s.signal, why);
							if (how === "fenced") return null;
							if (how !== "unreachable")
								return {
									type: "signalled",
									name: s.name,
									incarnation: s.incarnation,
									signal: s.signal,
									// `denied`: not this supervisor's child any more; nothing to stop.
									how: how === "denied" ? "noproc" : how,
									at: Date.now(),
								} as const;
							yield* Effect.sleep(Duration.millis(AGAIN_MS));
						}
					});
				const replyOne = (o: Outgoing) =>
					Effect.gen(function* () {
						const to = inboxOf(o.replyTo);
						for (;;) {
							// A reply-to that is no inbox, or nobody registered: dropped, as OTP drops it.
							if (to === null) return {type: "replied", id: o.id} as const;
							const r = yield* self.send(to, `reply:${o.id}`, {id: o.id, res: o.res});
							if (r.how === "fenced") return null;
							if (r.how !== "unreachable") return {type: "replied", id: o.id} as const;
							yield* Effect.sleep(Duration.millis(AGAIN_MS));
						}
					});
				const some = <A>(s: Stream.Stream<A | null>) =>
					s.pipe(Stream.filter((m): m is A => m !== null));
				const handle = yield* self.run(
					createSupervisor(name, spec, {
						incarnation: self.incarnation,
						parent: info?.parent ?? null,
					}),
					{schema: SupervisorState, cursor: (s) => s.cursor},
					{
						ctx: undefined,
						subscribe: {
							starts: (sub) =>
								some(Stream.fromIterable(sub.deps.list).pipe(Stream.mapEffect(startOne))),
							stops: (sub) => some(Stream.fromEffect(stopOne(sub.deps))),
							replies: (sub) =>
								some(Stream.fromIterable(sub.deps.list).pipe(Stream.mapEffect(replyOne))),
							give_up: (sub) =>
								Stream.fromEffect(self.exit("shutdown", sub.deps.why)).pipe(Stream.drain),
						},
					},
				);
				const machine = yield* handle.ready;
				yield* inputs.inbox.pipe(Stream.runForEach((e) => machine.dispatch(msgOf(e))));
			}).pipe(Effect.scoped),
	});

/**
 * A supervisor program to serve under `name`, or the reason its spec cannot work. Register `name`
 * (or have its own parent `startChild` it), then `serve` it on any hosts.
 */
export const supervisor = (name: string, spec: SupervisorSpec): Supervisor => {
	const why = refusalOf(name, spec);
	return why === null ? {ok: true, program: supervisorProgram(name, spec)} : {ok: false, why};
};
