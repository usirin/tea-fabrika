import type {Machine} from "@demlik/tea";
import {Clock, Effect, Equal, Hash, RcMap, Schema, type Scope} from "effect";
import {runKept} from "./kept.ts";
import type {AnyKind, Kinds, RefsOf, Watchable} from "./program.ts";
import type {Handle} from "./storage.ts";
import {ATTR} from "./trace.ts";

// The runs of each kind a program declares, reached by id: what `main` is
// handed as `machines`. A ref does nothing until it is started, and every
// start of one id while it runs shares one live copy:
//
//   const ship = machines.ship.get("pr/https://...");      // nothing read, nothing started
//   const runtime = yield* ship.start({type: "start", pr}); // the one live copy, or a new one
//   yield* ship.clear;                                      // its parent is done with it
//
// The live copies sit in Effect's `RcMap`, keyed by kind and id: a copy is
// booted once, by the first start, and lives while any caller's scope holds
// it. A second start while it is booting waits for the same copy, so one id
// never has two machines saving over each other, and nobody has to die for
// asking twice.
//
// A second start that brings another Msg than the one that started the copy
// fails with `AlreadyStarted`, the way Temporal answers a second start of a
// running workflow id (`WorkflowExecutionAlreadyStartedError`, its default
// conflict policy). `{conflict: "use_existing"}` shares the copy instead and
// drops the Msg, as Temporal's `USE_EXISTING` does; the drop is marked on the
// caller's span. The same Msg, or none, always shares.
//
// When `main` returns, `check` asks storage for each kind's runs. One that
// began, is not over, and is still kept was left unfinished: its parent never
// took it to its end, and the program fails, by name, rather than leave it
// for a start that may never come (experiment 74's stranding).

/**
 * A start that brought another Msg than the one the live copy was started
 * with: Temporal's `WorkflowExecutionAlreadyStartedError`.
 */
export class AlreadyStarted extends Schema.TaggedError<AlreadyStarted>()("AlreadyStarted", {
	machine: Schema.String,
	id: Schema.String,
	message: Schema.String,
}) {}

/**
 * What a start does on a live copy started with another Msg: Temporal's
 * `WorkflowIdConflictPolicy`. `fail`, the default, answers
 * {@link AlreadyStarted}; `use_existing` shares the copy and drops the Msg.
 */
export type Conflict = "fail" | "use_existing";

/** A status line, or why there is none: a line that throws hurts nobody else. */
export const lineOf = (status: ((state: unknown) => string) | undefined, state: unknown): string =>
	status === undefined
		? ""
		: Effect.runSync(
				Effect.try(() => status(state)).pipe(
					Effect.orElseSucceed(() => "no line: its status line threw"),
				),
			);

/** The key of one live copy: its kind and id. The start Msg rides along for the lookup, and is no part of the key. */
class Copy implements Equal.Equal {
	readonly kind: string;
	readonly id: string;
	readonly msg: unknown;
	constructor(kind: string, id: string, msg: unknown) {
		this.kind = kind;
		this.id = id;
		this.msg = msg;
	}
	[Equal.symbol](that: unknown): boolean {
		return that instanceof Copy && that.kind === this.kind && that.id === this.id;
	}
	[Hash.symbol](): number {
		return Hash.string(`${this.kind}/${this.id}`);
	}
}

/** One live copy: its runtime, and the Msg it was started with (`undefined`: none). */
interface Live {
	readonly runtime: unknown;
	readonly start: unknown;
}

type Show = (
	name: string,
	id: string,
	runtime: Watchable<unknown>,
) => Effect.Effect<void, never, Scope.Scope>;

/** Mark a moment on the caller's span, when there is one. */
const mark = (name: string, attributes: Record<string, string>) =>
	Effect.gen(function* () {
		const span = yield* Effect.currentParentSpan.pipe(Effect.option);
		if (span._tag === "None" || span.value._tag !== "Span") return;
		const clock = yield* Clock.Clock;
		span.value.event(name, clock.currentTimeNanosUnsafe(), attributes);
	});

/**
 * The refs of every kind, and the check `main`'s end runs. Made inside
 * `main`'s scope: every live copy is closed with it.
 */
export const refsOf = <
	Ks extends Kinds,
	B extends {readonly flags: unknown; readonly send: unknown},
>(
	program: string,
	kinds: Ks,
	handle: Handle,
	show: Show,
	base: B,
	/** Ends the program run: a failure tea reports once a copy is closing (./kept.ts). */
	broken: (cause: Error) => void,
) =>
	Effect.gen(function* () {
		const declaredKinds: Kinds = kinds;
		const kindOf = (name: string): Effect.Effect<AnyKind> => {
			const declared = declaredKinds[name];
			return declared === undefined
				? Effect.die(new Error(`${program} has no machine named ${name}`))
				: Effect.succeed(declared);
		};

		// RcMap runs the lookup with the context of the start that asked first (its services, its
		// span), and the copy's own scope. The services a copy needs are asked for in `start`'s type,
		// so the map itself needs none.
		const live = yield* RcMap.make({
			lookup: (copy: Copy) =>
				Effect.flatMap(kindOf(copy.kind), (declared) => {
					const status = declared.status as (state: unknown) => string;
					return runKept(
						handle,
						copy.kind,
						declared.machine as Machine<any, any, any, any, any>,
						copy.id,
						// The kind's own options for its own machine; typed apart where it was declared.
						declared.options(kit) as never,
						// A run found part way gets its kind's `recovered` Msg; one that never began, the caller's.
						(kept) => {
							const recovered: unknown = kept === null ? null : declared.recovered?.(kept);
							return recovered ?? copy.msg ?? null;
						},
						(runtime) => show(copy.kind, copy.id, runtime),
						(kept) => {
							const drawing = declared.drawing({
								id: copy.id,
								kept,
								start: copy.msg === undefined ? null : copy.msg,
							});
							// The copy's line is a tag on its span too, kept up with its state.
							return {
								...drawing,
								tags: (state: unknown) => ({
									...drawing.tags?.(state),
									[ATTR.status]: lineOf(status, state),
								}),
							};
						},
						broken,
					).pipe(Effect.map((runtime): Live => ({runtime, start: copy.msg})));
				}) as Effect.Effect<Live, unknown>,
		});

		const start =
			(name: string, id: string) => (msg?: unknown, options?: {readonly conflict?: Conflict}) =>
				Effect.gen(function* () {
					const copy = yield* RcMap.get(live, new Copy(name, id, msg));
					if (msg === undefined || (copy.start !== undefined && Equal.equals(copy.start, msg)))
						return copy.runtime;
					if (options?.conflict === "use_existing") {
						yield* mark(`start msg dropped: ${id}`, {[ATTR.machine]: name});
						return copy.runtime;
					}
					return yield* new AlreadyStarted({
						machine: name,
						id,
						message: `${program}'s ${name} run ${id} is live already, started with another Msg`,
					});
				});

		// A live copy saves after each Msg, so a clear under it would be undone by its next save.
		// Cleared only once every start of it has closed.
		const clear = (name: string, id: string) =>
			Effect.gen(function* () {
				if (yield* RcMap.has(live, new Copy(name, id, undefined)))
					return yield* Effect.die(
						new Error(
							`${program} cleared its ${name} run ${id} while it runs: its next save would keep it again`,
						),
					);
				yield* handle.clear(name, id);
			});

		const machines = Object.fromEntries(
			Object.keys(kinds).map((name) => [
				name,
				{
					get: (id: string) => ({
						id,
						start: start(name, id),
						read: handle.read(name, id),
						clear: clear(name, id),
					}),
					list: handle.list(name),
				},
			]),
			// One ref table per kind, built from `kinds` itself; the compiler cannot carry each kind's
			// own types through `Object.keys`.
		) as {readonly [K in keyof Ks]: RefsOf<Ks[K]>};
		const kit = {...base, machines};

		// What `main` left unfinished: every run that began, is not over, and is still kept. A run
		// kept before it began is dropped, quietly: nobody was waiting on it.
		const check = Effect.gen(function* () {
			const stranded: string[] = [];
			for (const [name, declared] of Object.entries(declaredKinds)) {
				const recovered = declared.recovered;
				if (recovered === undefined) continue;
				const {terminal} = declared.options(kit) as {
					readonly terminal?: (state: unknown) => boolean;
				};
				for (const run of yield* handle.list(name)) {
					if (terminal?.(run.state) === true) continue;
					if (recovered(run.state) === null) yield* handle.clear(name, run.id);
					else
						stranded.push(
							`${name} run ${run.id} unfinished: its parent ${declared.parent} never took it to its end`,
						);
				}
			}
			if (stranded.length > 0)
				return yield* Effect.die(new Error(`${program} ended with ${stranded.join("; ")}`));
		}).pipe(Effect.orDie);

		return {kit, check};
	});
