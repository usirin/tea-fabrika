// OTP's `supervisor`, `one_for_one`, as a tea program a host serves under a registered name like
// any other. Its children are names it starts with `Self.startChild`: the ledger registers each one
// under it as parent and links them. It traps exits, so a child's exit comes to its inbox as an
// EXIT message; it decides there, in its reducer, whether to start the child again.
//
//   permanent    always started again                      (OTP's default)
//   transient    started again only after a `crash`
//   temporary    never started again
//
// Restart intensity, OTP's word for the brake: at most `intensity` restarts within `periodMs`.
// One more and the supervisor gives up: it exits `shutdown`, and its links take its children down
// with it (OTP: the supervisor terminates its children, then itself, and its own parent decides).
// The window is read from the EXIT's `at`, the ledger's clock, so a replay decides the same way.
//
// A restart of the supervisor itself (its parent started it again: a new incarnation) starts every
// child again from the spec, as OTP's `init/1` does. A host takeover (same incarnation) changes
// nothing: the state replays, and a start still in flight is sent again. Every start names the
// child's incarnation it replaces (`after`), so a start sent twice starts the child once.
//
// `start_child` in its inbox adds a child at run time: Elixir's `DynamicSupervisor.start_child`, as
// a cast. The caller learns the child is up with a monitor, not from a reply.
//
// The machine is pure and exported (`createSupervisor`, `superviseWith`): the laws in
// `wip/src/laws/` walk it. `supervisor(spec)` refuses a spec that cannot work, rather than warn.
import {type DepKeyedSub, defineMachine, type Sub} from "@demlik/tea";
import {defineProgram} from "@tea-fabrika/tea-program";
import {input} from "@tea-fabrika/tea-program/shape";
import {Duration, Effect, Exit, Schedule, Schema, Stream} from "effect";
import {type Envelope, envelope, Self, type Starting} from "./host.ts";
import {ExitMessage} from "./ledger.ts";
import {MAX_DELIVERIES} from "./rules.ts";

// ---------------------------------------------------------------- the spec

export const Restart = Schema.Literals(["permanent", "transient", "temporary"]);
export type Restart = typeof Restart.Type;

export const ChildSpec = Schema.Struct({name: Schema.String, restart: Restart});
export type ChildSpec = typeof ChildSpec.Type;

export interface SupervisorSpec {
	/** OTP's restart strategy. Only `one_for_one`: a crashed child is started again, alone. */
	readonly strategy: "one_for_one";
	/** OTP's `intensity`: restarts allowed within `periodMs`. One more and the supervisor gives up. */
	readonly intensity: number;
	/** OTP's `period`, in milliseconds. */
	readonly periodMs: number;
	readonly children: readonly ChildSpec[];
	/**
	 * How many times in a row the ledger lets one message crash a program before it sets it aside
	 * (its `maxDeliveries`; `null`: never). Default `MAX_DELIVERIES`. The spec is refused when
	 * `intensity` is below it: one poison message would bring the whole tree down.
	 */
	readonly maxDeliveries?: number | null;
}

/** Why a spec is refused, or null: it can work. */
export const refusalOf = (name: string, spec: SupervisorSpec): string | null => {
	if (!Number.isInteger(spec.intensity) || spec.intensity < 0)
		return "intensity must be a whole number, 0 or more";
	if (!(spec.periodMs > 0)) return "periodMs must be more than 0";
	const names = spec.children.map((c) => c.name);
	if (new Set(names).size !== names.length) return "two children share a name";
	if (names.includes(name)) return "a child cannot be the supervisor's own name";
	const deliveries = spec.maxDeliveries === undefined ? MAX_DELIVERIES : spec.maxDeliveries;
	if (deliveries !== null && spec.intensity < deliveries)
		return `intensity ${spec.intensity} is below maxDeliveries ${deliveries}: one poison message would take the whole tree down before the ledger sets it aside`;
	return null;
};

// ---------------------------------------------------------------- the state

const Ended = Schema.Struct({
	incarnation: Schema.Number,
	reason: Schema.Literals(["normal", "shutdown", "crash"]),
	why: Schema.String,
	/** When the ledger wrote the exit, by the ledger's clock. */
	at: Schema.Number,
});
export type Ended = typeof Ended.Type;

export const Child = Schema.Struct({
	name: Schema.String,
	restart: Restart,
	/** The child's incarnation as last known: 0 before its first start. */
	incarnation: Schema.Number,
	/** A start in flight: the incarnation it replaces, or null (start it if it is not up). */
	start: Schema.NullOr(Schema.Struct({after: Schema.NullOr(Schema.Number)})),
	/** An exit that came while a start was in flight: decided once the start answers. */
	held: Schema.NullOr(Ended),
	/** No longer supervised: temporary, transient after a clean exit, or someone else's child. */
	gone: Schema.Boolean,
});
export type Child = typeof Child.Type;

export const SupervisorState = Schema.Struct({
	/** The inbox rev of the last message read. */
	cursor: Schema.Number,
	/** The supervisor's own incarnation this state belongs to: a new one starts from the spec. */
	incarnation: Schema.Number,
	/** Its own parent, if any: an EXIT from it shuts the supervisor down (OTP). */
	parent: Schema.NullOr(Schema.String),
	children: Schema.Array(Child),
	/** The `at` of each restart still inside the period: OTP's restart list. */
	restarts: Schema.Array(Schema.Number),
	/** Restarts in all, this incarnation. */
	restarted: Schema.Number,
	phase: Schema.Literals(["running", "shutdown"]),
	/** Why it gave up, or null. */
	why: Schema.NullOr(Schema.String),
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
};

// ---------------------------------------------------------------- the messages

export type SupervisorMsg =
	/** The program started: under which incarnation of itself, and who its parent is. */
	| {readonly type: "begin"; readonly incarnation: number; readonly parent: string | null}
	/** An EXIT from a linked name, at inbox rev `rev`. */
	| ({readonly type: "exit"; readonly rev: number; readonly from: string} & Ended)
	/** DynamicSupervisor's `start_child`, from the inbox. */
	| {
			readonly type: "start_child";
			readonly rev: number;
			readonly name: string;
			readonly restart: Restart;
	  }
	/** A start answered: the child is up at `incarnation` (or down there, its EXIT on the way). */
	| {readonly type: "started"; readonly name: string; readonly incarnation: number}
	/** A start refused: another name is the child's parent, or it is no name a register may take. */
	| {readonly type: "start_refused"; readonly name: string}
	/** Any other inbox message: read, and nothing else. */
	| {readonly type: "ignored"; readonly rev: number};

/** One start the `starts` Sub sends: the child, and the incarnation it replaces. */
export type Start = {readonly name: string; readonly after: number | null};
export type SupervisorSub =
	| Sub<"starts", {readonly list: readonly Start[]}>
	| Sub<"give_up", {readonly why: string}>;

// ---------------------------------------------------------------- the reducer

const fresh = (c: ChildSpec): Child => ({
	name: c.name,
	restart: c.restart,
	incarnation: 0,
	start: {after: null},
	held: null,
	gone: false,
});

const put = (s: SupervisorState, c: Child): SupervisorState => ({
	...s,
	children: s.children.map((x) => (x.name === c.name ? c : x)),
});

const giveUp = (s: SupervisorState, why: string): SupervisorState => ({
	...s,
	phase: "shutdown",
	why,
	children: s.children.map((c) => ({...c, start: null, held: null})),
});

/** OTP's `restart_child`: start `c` again, or let it go, or give up past the intensity. */
const decide =
	(spec: SupervisorSpec) =>
	(s: SupervisorState, c: Child, e: Ended): SupervisorState => {
		const known = {...c, incarnation: Math.max(c.incarnation, e.incarnation), held: null};
		if (c.restart === "temporary" || (c.restart === "transient" && e.reason !== "crash"))
			return put(s, {...known, start: null, gone: true});
		const restarts = [...s.restarts.filter((t) => t > e.at - spec.periodMs), e.at];
		if (restarts.length > spec.intensity)
			return giveUp(
				{...s, restarts},
				`reached_max_restart_intensity: ${restarts.length} restarts within ${spec.periodMs} ms, the last for ${c.name} (${e.reason}: ${e.why})`,
			);
		return put(
			{...s, restarts, restarted: s.restarted + 1},
			{...known, start: {after: e.incarnation}},
		);
	};

/** The supervisor's reducer: pure, and the same on every replay. */
export const superviseWith =
	(name: string, spec: SupervisorSpec) =>
	(s: SupervisorState, m: SupervisorMsg): SupervisorState => {
		const restart = decide(spec);
		switch (m.type) {
			case "begin": {
				if (m.incarnation === s.incarnation) return s;
				// A new incarnation: OTP's `init/1`, every child from the spec. The cursor stays: the
				// inbox before it was read by an earlier incarnation.
				return {
					...NOT_BEGUN,
					cursor: s.cursor,
					incarnation: m.incarnation,
					parent: m.parent,
					children: spec.children.map(fresh),
				};
			}
			case "exit": {
				if (m.rev <= s.cursor) return s;
				const read = {...s, cursor: m.rev};
				if (s.phase === "shutdown") return read;
				const e: Ended = {incarnation: m.incarnation, reason: m.reason, why: m.why, at: m.at};
				if (m.from === s.parent && m.from !== name)
					return giveUp(read, `parent ${m.from} exited (${m.reason})`);
				const c = read.children.find((x) => x.name === m.from);
				if (c === undefined || c.gone) return read;
				const after = c.start?.after ?? null;
				if (e.incarnation < c.incarnation || (after !== null && e.incarnation <= after))
					return read;
				if (c.start !== null) {
					const keep = c.held !== null && c.held.incarnation >= e.incarnation ? c.held : e;
					return put(read, {...c, held: keep});
				}
				return restart(read, c, e);
			}
			case "start_child": {
				if (m.rev <= s.cursor) return s;
				const read = {...s, cursor: m.rev};
				if (s.phase === "shutdown" || m.name === name) return read;
				if (read.children.some((x) => x.name === m.name)) return read;
				return {
					...read,
					children: [...read.children, fresh({name: m.name, restart: m.restart})],
				};
			}
			case "started": {
				const c = s.children.find((x) => x.name === m.name);
				if (c === undefined || c.start === null || s.phase === "shutdown") return s;
				const up = {...c, incarnation: Math.max(c.incarnation, m.incarnation), start: null};
				if (c.held !== null && c.held.incarnation >= m.incarnation)
					return restart(put(s, {...up, held: null}), up, c.held);
				return put(s, {...up, held: null});
			}
			case "start_refused": {
				const c = s.children.find((x) => x.name === m.name);
				if (c === undefined || c.start === null) return s;
				return put(s, {...c, start: null, held: null, gone: true});
			}
			case "ignored":
				return m.rev <= s.cursor ? s : {...s, cursor: m.rev};
		}
	};

/** The starts in flight, in child order: the `starts` Sub's deps. */
export const startsOf = (s: SupervisorState): readonly Start[] =>
	s.phase === "shutdown"
		? []
		: s.children.flatMap((c) => (c.start === null ? [] : [{name: c.name, after: c.start.after}]));

export const createSupervisor = (name: string, spec: SupervisorSpec) => {
	const step = superviseWith(name, spec);
	const update = (s: SupervisorState, m: SupervisorMsg): [SupervisorState, never[]] => [
		step(s, m),
		[],
	];
	return defineMachine<SupervisorState, SupervisorMsg, never, SupervisorSub, undefined>({
		types: {
			model: {} as SupervisorState,
			msg: {} as SupervisorMsg,
			cmd: {} as never,
			sub: {} as SupervisorSub,
			ctx: undefined,
		},
		init: (loaded) => [loaded ?? NOT_BEGUN, []],
		update: {
			begin: update,
			exit: update,
			start_child: update,
			started: update,
			start_refused: update,
			ignored: update,
		},
		subs: [
			// The casts: tea's `DepKeyedSub` is a conditional type a literal cannot be checked against.
			{
				type: "starts",
				deps: (s: SupervisorState) => {
					const list = startsOf(s);
					return list.length === 0 ? null : {list};
				},
			} as DepKeyedSub<SupervisorState, SupervisorSub>,
			{
				type: "give_up",
				deps: (s: SupervisorState) => (s.phase === "shutdown" ? {why: s.why ?? "shutdown"} : null),
			} as DepKeyedSub<SupervisorState, SupervisorSub>,
		],
	});
};

// ---------------------------------------------------------------- the inbox

/** The body of a `start_child` cast. */
export const StartChild = Schema.Struct({start_child: ChildSpec});

const decodeExit = Schema.decodeUnknownExit(ExitMessage);
const decodeStart = Schema.decodeUnknownExit(StartChild);

/** One inbox envelope as the supervisor reads it. Only the ledger writes an `EXIT`. */
export const msgOf = (e: Envelope<unknown>): SupervisorMsg => {
	if (e.kind === "EXIT" && e.from === "ledger") {
		const x = decodeExit(e.body);
		if (Exit.isSuccess(x)) {
			const {from, incarnation, reason, why, at} = x.value;
			return {type: "exit", rev: e.rev, from, incarnation, reason, why, at};
		}
	}
	if (e.kind === "cast" || e.kind === "message") {
		const x = decodeStart(e.body);
		if (Exit.isSuccess(x)) return {type: "start_child", rev: e.rev, ...x.value.start_child};
	}
	return {type: "ignored", rev: e.rev};
};

// ---------------------------------------------------------------- the program

/** A lease word for `main` to die with: the host reads it as a lost lease, not a crash. */
const fencedOut = (what: string) => Effect.die({_tag: "Fenced", what});

export type Supervisor =
	| {readonly ok: true; readonly program: ReturnType<typeof supervisorProgram>}
	| {readonly ok: false; readonly why: string};

const supervisorProgram = (name: string, spec: SupervisorSpec) =>
	defineProgram({
		name: "supervisor",
		description:
			"OTP's one_for_one supervisor: starts its children, starts a crashed one again, and gives up past its restart intensity.",
		inputs: {
			inbox: input(envelope(Schema.Unknown), "An EXIT from a child, or a start_child cast."),
		},
		outputs: {},
		main: ({inputs}) =>
			Effect.gen(function* () {
				const self = yield* Self;
				if (self.name !== name)
					return yield* Effect.die(`supervisor for ${name} served under ${self.name}`);
				// Exits first: a child's exit must come as a message, never take this name down.
				if ((yield* self.trapExit(true)) !== "ok") return yield* fencedOut("trap_exit");
				// A ledger that does not answer for a second ends this run as a lost lease, not a crash.
				const info = yield* self.reads
					.processInfo(name)
					.pipe(
						Effect.retry({times: 19, schedule: Schedule.spaced(Duration.millis(50))}),
						Effect.orDie,
					);
				const startOne = (s: Start) =>
					Effect.gen(function* () {
						for (;;) {
							const r: Starting = yield* self.startChild(s.name, s.after);
							if (r.how === "ok")
								return {type: "started", name: s.name, incarnation: r.incarnation} as const;
							if (r.how === "denied") return {type: "start_refused", name: s.name} as const;
							if (r.how === "fenced") return null;
							yield* Effect.sleep(Duration.millis(100));
						}
					});
				const handle = yield* self.run(
					createSupervisor(name, spec),
					{schema: SupervisorState, cursor: (s) => s.cursor},
					{
						ctx: undefined,
						subscribe: {
							starts: (sub) =>
								Stream.fromIterable(sub.deps.list).pipe(
									Stream.mapEffect(startOne),
									Stream.filter((m): m is NonNullable<typeof m> => m !== null),
								),
							give_up: (sub) =>
								Stream.fromEffect(self.exit("shutdown", sub.deps.why)).pipe(Stream.drain),
						},
					},
				);
				const machine = yield* handle.ready;
				yield* machine.dispatch({
					type: "begin",
					incarnation: self.incarnation,
					parent: info?.parent ?? null,
				});
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
